
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, euint64 } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

// Contract header metadata placeholder
contract ReviewSentimentFHE is SepoliaConfig {
    // Sequential identifier counter
    uint256 public reviewCounter;

    // Encrypted review container
    struct EncryptedReview {
        uint256 id;
        euint32 reviewerEncryption; // encrypted reviewer tag
        euint32 reviewTextEnc;      // encrypted review text
        euint32 embeddingEnc;       // encrypted text embedding for FHE-NLP
        uint256 ts;                 // timestamp
    }

    // Plaintext record after controlled reveal
    struct PlainReview {
        string reviewerTag;
        string reviewText;
        string department;
        bool revealed;
    }

    // Storage maps
    mapping(uint256 => EncryptedReview) public encryptedReviews;
    mapping(uint256 => PlainReview) public plainReviews;
    mapping(bytes32 => euint32) private encryptedDeptSentiment; // encrypted aggregated sentiment per department
    string[] private departments;
    mapping(uint256 => uint256) private decryptRequestToId; // maps FHE request IDs to internal references

    // Operator address for administrative actions
    address public admin;

    // Events used for off-chain watchers
    event ReviewSubmitted(uint256 indexed id, uint256 when);
    event SentimentRequested(uint256 indexed id, uint256 requestId);
    event ReviewRevealed(uint256 indexed id);
    event DepartmentAggregated(bytes32 indexed deptHash);

    // Constructor sets the admin
    constructor() {
        admin = msg.sender;
    }

    // Modifier to restrict certain calls to admin
    modifier onlyAdmin() {
        require(msg.sender == admin, "not authorized");
        _;
    }

    // Modifier stub for reviewer authorization checks
    modifier onlyReviewer(uint256 /*id*/) {
        _;
    }

    // Submit a single encrypted review
    function submitEncryptedReview(
        euint32 reviewerEncryption,
        euint32 reviewTextEnc,
        euint32 embeddingEnc
    ) public {
        reviewCounter += 1;
        uint256 rid = reviewCounter;

        encryptedReviews[rid] = EncryptedReview({
            id: rid,
            reviewerEncryption: reviewerEncryption,
            reviewTextEnc: reviewTextEnc,
            embeddingEnc: embeddingEnc,
            ts: block.timestamp
        });

        plainReviews[rid] = PlainReview({
            reviewerTag: "",
            reviewText: "",
            department: "",
            revealed: false
        });

        emit ReviewSubmitted(rid, block.timestamp);
    }

    // Batch submission support for efficiency
    function submitBatchReviews(
        euint32[] memory reviewerEncs,
        euint32[] memory textsEnc,
        euint32[] memory embeddingsEnc
    ) public {
        require(reviewerEncs.length == textsEnc.length && textsEnc.length == embeddingsEnc.length, "length mismatch");
        for (uint256 i = 0; i < reviewerEncs.length; i++) {
            submitEncryptedReview(reviewerEncs[i], textsEnc[i], embeddingsEnc[i]);
        }
    }

    // Request homomorphic sentiment scoring or reveal for a review
    function requestReviewSentiment(uint256 reviewId) public onlyReviewer(reviewId) {
        EncryptedReview storage er = encryptedReviews[reviewId];
        require(!plainReviews[reviewId].revealed, "already revealed");

        bytes32[] memory payload = new bytes32[](2);
        payload[0] = FHE.toBytes32(er.reviewTextEnc);
        payload[1] = FHE.toBytes32(er.embeddingEnc);

        uint256 req = FHE.requestDecryption(payload, this.handleSentimentResult.selector);
        decryptRequestToId[req] = reviewId;

        emit SentimentRequested(reviewId, req);
    }

    // Callback invoked by FHE runtime with decrypted sentiment or plaintext parts
    function handleSentimentResult(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 rid = decryptRequestToId[requestId];
        require(rid != 0, "invalid request");

        PlainReview storage pr = plainReviews[rid];
        require(!pr.revealed, "already revealed");

        // Verify FHE proof before consuming cleartexts
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode expected payload: [string reviewerTag, string reviewText, string department, int32 sentimentScore]
        // The actual cleartext format is domain-specific; decode defensively
        bytes memory ct = cleartexts;
        string[] memory parts = abi.decode(ct, (string[]));

        if (parts.length >= 3) {
            pr.reviewerTag = parts[0];
            pr.reviewText = parts[1];
            pr.department = parts[2];
            pr.revealed = true;
        } else {
            revert("invalid cleartext format");
        }

        // Update department-level encrypted sentiment counter if present
        // Assume sentiment was computed homomorphically and stored in encryptedDeptSentiment map
        bytes32 deptHash = keccak256(abi.encodePacked(pr.department));
        if (!FHE.isInitialized(encryptedDeptSentiment[deptHash])) {
            encryptedDeptSentiment[deptHash] = FHE.asEuint32(0);
            departments.push(pr.department);
        }

        // Homomorphically add a unit to the department's sentiment aggregate (placeholder)
        encryptedDeptSentiment[deptHash] = FHE.add(encryptedDeptSentiment[deptHash], FHE.asEuint32(1));

        emit ReviewRevealed(rid);
        emit DepartmentAggregated(deptHash);
    }

    // Admin can trigger department aggregation decryption requests
    function requestDepartmentAggregateDecryption(string memory department) public onlyAdmin {
        bytes32 dHash = keccak256(abi.encodePacked(department));
        euint32 agg = encryptedDeptSentiment[dHash];
        require(FHE.isInitialized(agg), "department unknown");

        bytes32[] memory payload = new bytes32[](1);
        payload[0] = FHE.toBytes32(agg);

        uint256 req = FHE.requestDecryption(payload, this.handleDepartmentAggregate.selector);
        decryptRequestToId[req] = uint256(dHash);
    }

    // Callback for decrypted department aggregates
    function handleDepartmentAggregate(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 mapped = decryptRequestToId[requestId];
        require(mapped != 0, "invalid mapping");

        // Verify proof
        FHE.checkSignatures(requestId, cleartexts, proof);

        // Decode a numeric aggregate (e.g., int32 or uint32)
        uint32 value = abi.decode(cleartexts, (uint32));
        // Placeholder: consume decrypted aggregate for off-chain reporting
        mapped; value;
    }

    // View revealed review details
    function getRevealedReview(uint256 reviewId) public view returns (
        string memory reviewerTag,
        string memory reviewText,
        string memory department,
        bool revealed
    ) {
        PlainReview storage pr = plainReviews[reviewId];
        return (pr.reviewerTag, pr.reviewText, pr.department, pr.revealed);
    }

    // Return encrypted aggregate for a department
    function getEncryptedDepartmentAggregate(string memory department) public view returns (euint32) {
        bytes32 dHash = keccak256(abi.encodePacked(department));
        return encryptedDeptSentiment[dHash];
    }

    // List known departments
    function listDepartments() public view returns (string[] memory) {
        return departments;
    }

    // Operator can rotate admin
    function setAdmin(address newAdmin) public onlyAdmin {
        require(newAdmin != address(0), "zero address");
        admin = newAdmin;
    }

    // Utility: convert bytes32 to uint256
    function _b32ToUint(bytes32 b) internal pure returns (uint256) {
        return uint256(b);
    }

    // Fallback functions
    receive() external payable { }
    fallback() external payable { }
}
