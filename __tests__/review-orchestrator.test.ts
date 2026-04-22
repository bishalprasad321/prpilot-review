import { ReviewOrchestrator } from "../src/review/review-orchestrator";
import { ReviewerOpinion } from "../src/utils/types";

describe("ReviewOrchestrator", () => {
  it("treats a 2-of-3 reviewer agreement as consensus", () => {
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

    expect(result).toEqual({
      isConsensus: true,
      decision: "APPROVE",
    });
  });
});
