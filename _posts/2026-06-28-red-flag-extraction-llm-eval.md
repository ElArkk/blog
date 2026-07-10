---
layout: post
title: "How Far Have Open-Weight LLMs Come? Benchmarking Red- and Green-Flag Extraction on SEC 8-Ks"
date: 2026-06-28
permalink: /red-flag-extraction-llm-eval
image: /assets/img/og/red-flag-extraction-llm-eval.webp
image_alt: "SEC 8-K evaluation illustration with red and green flags, charts, and model comparison visuals"
categories:
  - "agentic"
excerpt: "A reference-free benchmark for red- and green-flag extraction from SEC 8-K filings, plus some background on running the eval on self-hosted Langfuse and keeping LLM-agent-driven eval work honest."
---

I wrote a piece for the Bollwerk blog about benchmarking LLMs on red- and green-flag extraction from SEC 8-K filings. The eval runs the same reference-free setup across closed and open-weight models, with a keyword baseline, repeated stochastic runs, model-graded scoring, pool-bias checks, and severity calibration.

The short version: Opus and Sonnet lead on red flags, GLM-5.2 lands in the closed-model cluster, ties GPT-5.5 on red at about a sixth of the extraction cost, and beats it on green flags. The more useful lesson is methodological: real filings, mirror tasks, deterministic baselines, repeated runs, and error bars give you a cleaner model-selection signal than leaderboard labels.

Some background that didn't fit into the company post: I ran the eval on our self-hosted Langfuse instance. That instance runs on AWS Lightsail with S3 for object storage. A few years ago, setting that up would probably have become its own infrastructure project. This time I had the AWS CLI, an agent driving the work, and parallel MCP research feeding it documentation and implementation options. It was up in a day, and the agent did almost all of it.

That changed the shape of the work. Infrastructure became the easy part. The hard part was keeping the eval itself honest while an LLM agent moved quickly through code, analysis, charts, and prose.

The review cycle uncovered some interesting issues. I found round-number corpora with undocumented exclusions, a pooled closed-minus-open headline that was carried by one weak open model, significance language that only measured run-to-run noise on a fixed corpus, and deterministic graders whose names made them sound more independent than they were.

The false-alarm analysis was the best example of a result that looked publishable before the metric was inspected. One model fired on filings the reference treated as clean while the others didn't, which made for a very clean chart. The first draft framed that as a precision problem.

The problem was the word "clean." It only meant the synthesizer hadn't returned a flag for that filing. There was no human or independent process establishing that no flag existed. Some of those filings came from a detector-flagged stratum too, so the prior was already weird: the corpus had filings selected because something about them looked suspicious, then the absence of a synthesized flag was treated as proof that model findings there were false alarms.

That made the denominator too soft for the claim. The model could have been overcalling, or it could have been finding real issues that the reference missed. The chart still mattered as a debugging lead, because a 12-versus-0 split is too sharp to ignore. It just didn't deserve to become a headline metric without its own adjudication path.

The closed-versus-open story had a similar problem at a larger scale. We had a headline like "closed models lead open models by X points," backed by a clean average and intervals that cleared zero. The aggregate sounded stronger than the sample. The open group had only 2 models, and one weak open model dragged the average down. Against GLM-5.2 alone, the closed models were only slightly ahead and the gap was inside the noise; against Kimi, the gap was large. Averaging those 2 together turned a model-specific result into a category claim. That was a huge overstatement for a benchmark with 2 open models.

The recurring pattern was simple: agents are very good at carrying a framing forward. If a number has a tidy narrative around it, the agent will often make that narrative smoother before it checks whether the number deserves to exist.

My current best practices for agent-assisted eval work:

1. **Persist every corpus decision.** The earlier version kept a round 20-filing corpus by dropping extra filings. Once checked, some of the excluded filings contained real flags, so the round number had quietly shaped the result.

2. **Make the decomposition control the headline.** The agent had already surfaced the important split: GLM-5.2 was close to the closed models, while Kimi accounted for most of the category gap. It still kept using the pooled closed-versus-open average in the opening because the averaged metric made a cleaner story. Knowing the caveat isn't enough if the prose keeps optimizing around the aggregate.

3. **Treat deterministic checks as limited instruments.** The word-overlap grader removed judge randomness, but it still rewarded findings phrased like the LLM-written reference. The strict quote-grounding check mostly caught quote stitching and whitespace drift.

4. **Name what your uncertainty measures.** Three repeated runs showed that the ordering was reproducible on the fixed corpus and frozen reference. They didn't say how much the result would move under a different filing sample or another pair of open models. The wording of the initial agent driven draft did not name this caveat.

5. **Re-read the whole artifact after every reframe.** After the pooled category claim was removed, bits of the old closed-versus-open story still survived in prose and chart captions. Local edits don't catch global residue.

6. **Use the agent for momentum, but make it show its work.** Ask for the rows behind the chart, the filings behind the corpus count, and the prompt text behind any claim about what the pipeline does. The summary is where the agent is most likely to preserve a convenient story.

The company post is about the benchmark result. The private lesson for me was about process. LLM agents make it much easier to build eval infrastructure and run serious review loops, but they also amplify whatever framing you give them. The defense is boring and effective: persist inputs, decompose aggregates, and cut any claim that only survives because the story around it sounds good.

Read the full post here: [How Far Have Open-Weight LLMs Come? Benchmarking Red- and Green-Flag Extraction on SEC 8-Ks](https://bollwerk.ai/blog/red-flag-extraction-llm-eval/).
