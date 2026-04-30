# Architecture Decision Records (ADR)

This directory contains Architecture Decision Records (ADRs) documenting major design decisions for the PR Pilot Review project.

## Overview

ADRs are records of architecturally significant decisions made in the project. They help document:

- **Why** certain decisions were made
- **What** alternatives were considered
- **Consequences** (positive and negative)
- **Context** when decisions were made

## Index

| ADR                                                        | Title                                      | Status   | Date       |
| ---------------------------------------------------------- | ------------------------------------------ | -------- | ---------- |
| [ADR-001](./ADR-001-multi-model-consensus-architecture.md) | Multi-Model Consensus Architecture         | Accepted | 2026-04-23 |
| [ADR-002](./ADR-002-api-api-integration.md)                | LLM Provider Integration & Model Selection | Accepted | 2026-04-23 |
| [ADR-003](./ADR-003-inline-comment-mapping.md)             | Inline Comment Mapping & Line Accuracy     | Accepted | 2026-04-23 |
| [ADR-004](./ADR-004-idempotency-state-management.md)       | Idempotency & State Management             | Accepted | 2026-04-23 |

## Reading Guide

Start with **ADR-001** for the overall architecture, then read others based on your interest:

- **Interested in model selection?** → Read **ADR-002**
- **Debugging inline comments?** → Read **ADR-003**
- **Understanding idempotency?** → Read **ADR-004**

## Status Legend

- **Accepted** — Implemented and in use
- **Proposed** — Under discussion
- **Rejected** — Decision not taken
- **Superseded** — Replaced by later ADR

---

**See individual ADR files for detailed analysis.**
