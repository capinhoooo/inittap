// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

address constant JSONUTILS_ADDRESS = 0x00000000000000000000000000000000000000f3;
IJSONUtils constant JSONUTILS_CONTRACT = IJSONUtils(JSONUTILS_ADDRESS);

interface IJSONUtils {
    struct JSONElement {
        string key;
        bytes value;
    }

    struct JSONObject {
        JSONElement[] elements;
    }

    function merge_json(
        string memory dst_json,
        string memory src_json
    ) external view returns (string memory);
    function stringify_json(
        string memory json
    ) external view returns (string memory);
    function unmarshal_to_object(bytes memory json_bytes) external view returns (JSONObject memory);
    function unmarshal_to_array(bytes memory json_bytes) external view returns (bytes[] memory);
    function unmarshal_to_string(bytes memory json_bytes) external view returns (string memory);
    function unmarshal_to_uint(bytes memory json_bytes) external view returns (uint256);
    function unmarshal_to_bool(bytes memory json_bytes) external view returns (bool);
    function unmarshal_iso_to_unix(bytes memory json_bytes) external view returns (uint256);
}
