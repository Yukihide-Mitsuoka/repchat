---
name: presentation
description: Create or revise slide decks when the task requires a presentation, PowerPoint, PPTX, or Google Slides artifact with visual verification.
---

# Skill: Presentation authoring

## Purpose

Produce an evidence-based presentation that its audience can understand and use, then
verify the rendered slides rather than treating an outline or source file as complete.

## Inputs

Establish the purpose, audience, decision or action sought, presentation duration,
language, output format, source material, delivery setting, and brand or accessibility
constraints. Infer only low-impact omissions and state those assumptions. Ask before
proceeding when a missing choice would materially change the deck.

Read the supplied sources and the repository's relevant requirements, terminology, and
brand assets. Distinguish verified facts, accepted decisions, assumptions, inferences,
and open questions. Never invent a statistic, quotation, customer claim, or citation.

## Process

1. State the communication goal in one sentence: audience, intended outcome, and the
   evidence or decision the deck must convey.
2. Build the storyline before layout. Lead with the answer when known, arrange the
   supporting points in a deliberate order, and assign one primary message to each
   slide. Use takeaway titles instead of topic labels when the conclusion is known.
3. Create a slide plan containing the slide number, message, supporting evidence,
   suitable visual form, source, and speaker-note need. Remove slides that do not
   advance the communication goal.
4. Select an already available presentation-capable tool that can produce the requested
   format. Preserve editable source when the task requires future maintenance. Do not
   install a dependency, invoke an external service, or silently substitute another
   output format without applicable permission.
5. Generate the deck. Match representation to the relationship: prose for reasoning,
   tables for repeated comparisons, charts for quantitative patterns, and diagrams for
   relationships that are materially clearer visually. Avoid decorative visuals that
   add no information.
6. Keep each slide readable in its delivery setting. Establish a clear visual hierarchy,
   consistent alignment and spacing, sufficient contrast, and concise on-slide text.
   Put supporting narration in speaker notes when appropriate. Cite evidence close to
   the claim and preserve any required attribution.
7. Render every slide to images or PDF with the available tool and inspect the actual
   output. Check for clipping, overlap, overflow, unreadable text, broken or distorted
   visuals, weak contrast, inconsistent layout, missing citations, and timing or slide
   count that conflicts with the stated delivery constraint.
8. Correct observed defects and render again until the inspected output is clean. Verify
   that the final artifact opens and that temporary render files are not delivered or
   committed unless requested.
9. Deliver the editable source and requested presentation artifact, plus a concise list
   of sources, assumptions, and completed visual checks. State any unverified property
   or unavailable format explicitly.

## Decision criteria

- Follow an existing project location or explicit output path. Otherwise use
  `docs/presentations/<deck-name>/` for a repository-maintained deck and its local
  source assets; keep temporary renders outside the maintained artifact set.
- Use an existing approved brand template when supplied. Do not reconstruct a logo,
  typeface, or brand rule from memory.
- Prefer a simple text slide when a visual would not improve comprehension. Prefer a
  diagram, table, or chart when it materially clarifies relationships that prose hides.
- Use primary or authoritative sources for material claims. When sources conflict,
  report the conflict instead of selecting convenient evidence silently.
- If the requested renderer or format is unavailable, report the concrete limitation
  and the smallest safe alternative; do not claim completion in another format.

## Outputs

- Editable deck source and the requested final presentation artifact.
- Source and assumption record sufficient to review material claims.
- Render-based verification result, including any limitation not checked.

## Checklist

- [ ] Audience, purpose, decision, duration, language, and format are explicit
- [ ] Every slide has a necessary primary message and traceable supporting evidence
- [ ] No unsupported fact, quotation, citation, brand asset, or capability is fabricated
- [ ] Every slide was rendered, visually inspected, corrected, and rendered again as needed
- [ ] Final files open, match the requested format, and exclude unintended temporary artifacts
- [ ] Delivery states sources, assumptions, verification performed, and remaining limitations
