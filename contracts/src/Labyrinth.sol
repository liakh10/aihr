// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title AI Labyrinth
/// The maze is stored here, cell by cell, together with the twelve stations along its only path. A run is a list of
/// moves; the contract walks it over its own map, refuses a step into a wall, requires the stations in order and the
/// exit at the end, and records who finished and in how many steps. The browser only reads the map from here and
/// hands the moves back. There is no owner and nothing to withdraw.
contract Labyrinth {
    uint8 public immutable width;
    uint8 public immutable height;
    uint16 public immutable start;
    uint16 public immutable exit;
    bytes public map;               // one byte per cell, 0 open, 1 wall
    uint16[] internal _checkpoints; // cell index of each station, in the order they must be reached
    string[] internal _labels;      // "1956 Dartmouth gives it a name"

    struct Run { address runner; uint32 steps; uint64 time; }
    Run[] internal _runs;
    mapping(address => uint32) public bestSteps;   // 0 = never finished
    mapping(address => uint32) public finishes;
    uint32 public recordSteps;                     // fewest steps by anyone
    address public recordHolder;
    uint256 public constant MAX_MOVES = 6000;

    event Finished(address indexed runner, uint32 steps, uint256 indexed index, bool personalBest, bool record);

    constructor(uint8 w, uint8 h, uint16 start_, uint16 exit_, bytes memory map_, uint16[] memory checkpoints_, string[] memory labels_) {
        require(map_.length == uint256(w) * h && checkpoints_.length == labels_.length && checkpoints_.length > 0, "shape");
        require(map_[start_] == 0 && map_[exit_] == 0, "start or exit is a wall");
        width = w; height = h; start = start_; exit = exit_; map = map_;
        for (uint256 i = 0; i < checkpoints_.length; i++) { require(map_[checkpoints_[i]] == 0, "station in a wall"); _checkpoints.push(checkpoints_[i]); _labels.push(labels_[i]); }
    }

    // ---------------------------------------------------------------- the judge

    /// Walks the moves. 0 up, 1 right, 2 down, 3 left. Returns how far it got: ok only if every station was passed in
    /// order and the last cell is the exit. `reached` is the number of stations passed, `stopped` the cell where a wall
    /// or the edge ended the walk (or the final cell when the walk completed).
    function verify(bytes calldata moves) public view returns (bool ok, uint32 steps, uint8 reached, uint16 stopped) {
        bytes memory m = map;
        uint256 w = width;
        uint256 cell = start;
        uint256 next = 0;
        uint256 n = _checkpoints.length;
        uint256 len = moves.length;
        if (len == 0 || len > MAX_MOVES) return (false, 0, 0, uint16(cell));
        for (uint256 i = 0; i < len; i++) {
            uint8 d = uint8(moves[i]);
            uint256 x = cell % w; uint256 y = cell / w;
            if (d == 0) { if (y == 0) return (false, uint32(i), uint8(next), uint16(cell)); cell -= w; }
            else if (d == 1) { if (x + 1 >= w) return (false, uint32(i), uint8(next), uint16(cell)); cell += 1; }
            else if (d == 2) { if (y + 1 >= height) return (false, uint32(i), uint8(next), uint16(cell)); cell += w; }
            else if (d == 3) { if (x == 0) return (false, uint32(i), uint8(next), uint16(cell)); cell -= 1; }
            else return (false, uint32(i), uint8(next), uint16(cell));
            if (m[cell] != 0) return (false, uint32(i), uint8(next), uint16(cell));
            if (next < n && cell == _checkpoints[next]) next++;
        }
        ok = next == n && cell == exit;
        return (ok, uint32(len), uint8(next), uint16(cell));
    }

    /// Records a finished run. Anyone can call for their own wallet; a run is only accepted if verify says so.
    function submit(bytes calldata moves) external returns (uint256 index) {
        (bool ok, uint32 steps, uint8 reached, uint16 stopped) = verify(moves);
        if (!ok) revert Rejected(steps, reached, stopped);
        index = _runs.length;
        _runs.push(Run(msg.sender, steps, uint64(block.timestamp)));
        finishes[msg.sender] += 1;
        bool pb = bestSteps[msg.sender] == 0 || steps < bestSteps[msg.sender];
        if (pb) bestSteps[msg.sender] = steps;
        bool rec = recordSteps == 0 || steps < recordSteps;
        if (rec) { recordSteps = steps; recordHolder = msg.sender; }
        emit Finished(msg.sender, steps, index, pb, rec);
    }
    error Rejected(uint32 steps, uint8 reached, uint16 stopped);

    // ---------------------------------------------------------------- views for the site

    function stations() external view returns (uint16[] memory cells, string[] memory labels) { return (_checkpoints, _labels); }
    function stationCount() external view returns (uint256) { return _checkpoints.length; }
    function runCount() external view returns (uint256) { return _runs.length; }
    function runs(uint256 from, uint256 n) external view returns (Run[] memory out) {
        uint256 total = _runs.length;
        if (from >= total) return new Run[](0);
        uint256 end = from + n > total ? total : from + n;
        out = new Run[](end - from);
        for (uint256 i = from; i < end; i++) out[i - from] = _runs[i];
    }
    /// The whole maze in one call: dimensions, start, exit, the map, the stations.
    function board() external view returns (uint8 w, uint8 h, uint16 s, uint16 e, bytes memory m, uint16[] memory cells, string[] memory labels, uint256 nRuns, uint32 record, address holder) {
        return (width, height, start, exit, map, _checkpoints, _labels, _runs.length, recordSteps, recordHolder);
    }
}
