import { ReviewOrchestrator } from "../src/review/review-orchestrator";
import { ReviewerOpinion } from "../src/utils/types";

describe("ReviewOrchestrator", () => {
  it("requires unanimous agreement (all 3) for consensus in early rounds", () => {
    const orchestrator = new ReviewOrchestrator("test-key", {
      reviewerModels: [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
      ],
      judgeModel: "gemini-2.5-pro",
      maxConsensusRounds: 3,
    });

    const opinions: ReviewerOpinion[] = [
      {
        reviewerId: "Reviewer_1",
        modelName: "gemini-2.5-flash",
        decision: "COMMENT",
        reasoning: "Minor note.",
        findings: [],
        summary: "Summary",
        timestamp: new Date().toISOString(),
      },
      {
        reviewerId: "Reviewer_2",
        modelName: "gemini-2.5-flash-lite",
        decision: "APPROVE",
        reasoning: "Looks good.",
        findings: [],
        summary: "Summary",
        timestamp: new Date().toISOString(),
      },
      {
        reviewerId: "Reviewer_3",
        modelName: "gemini-2.0-flash",
        decision: "APPROVE",
        reasoning: "No issues found.",
        findings: [],
        summary: "Summary",
        timestamp: new Date().toISOString(),
      },
    ];

    const result = (
      orchestrator as unknown as {
        evaluateConsensus: (input: ReviewerOpinion[]) => {
          isConsensus: boolean;
          decision: string;
        };
      }
    ).evaluateConsensus(opinions);

    // With 2-of-3 agreement (not unanimous), consensus is NOT achieved
    expect(result).toEqual({
      isConsensus: false,
      decision: "COMMENT",
    });
  });

  it("achieves consensus when all 3 reviewers agree", () => {
    const orchestrator = new ReviewOrchestrator("test-key", {
      reviewerModels: [
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.0-flash",
      ],
      judgeModel: "gemini-2.5-pro",
      maxConsensusRounds: 3,
    });

    const opinions: ReviewerOpinion[] = [
      {
        reviewerId: "Reviewer_1",
        modelName: "gemini-2.5-flash",
        decision: "APPROVE",
        reasoning: "Looks good.",
        findings: [],
        summary: "Summary",
        timestamp: new Date().toISOString(),
      },
      {
        reviewerId: "Reviewer_2",
        modelName: "gemini-2.5-flash-lite",
        decision: "APPROVE",
        reasoning: "Looks good.",
        findings: [],
        summary: "Summary",
        timestamp: new Date().toISOString(),
      },
      {
        reviewerId: "Reviewer_3",
        modelName: "gemini-2.0-flash",
        decision: "APPROVE",
        reasoning: "No issues found.",
        findings: [],
        summary: "Summary",
        timestamp: new Date().toISOString(),
      },
    ];

    const result = (
      orchestrator as unknown as {
        evaluateConsensus: (input: ReviewerOpinion[]) => {
          isConsensus: boolean;
          decision: string;
        };
      }
    ).evaluateConsensus(opinions);

    // All 3 agree on APPROVE
    expect(result).toEqual({
      isConsensus: true,
      decision: "APPROVE",
    });
  });
});
