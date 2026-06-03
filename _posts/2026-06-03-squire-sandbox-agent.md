---
layout: post
title: "Squire: A Sandbox Coding Agent You Can Hand the Keys To"
date: 2026-06-03
permalink: /squire-sandbox-agent
image: /assets/img/og/squire-sandbox-agent.webp
image_alt: "Sandboxed background coding agent illustration"
categories:
  - "agentic"
  - "python"
excerpt: "A background coding agent with no GitHub write credentials and tightly controlled network egress. Repository writes are replayed deterministically outside the sandbox, so a compromised agent structurally can't reach your repos or the wider network."
---

I wrote a piece for the Bollwerk blog about Squire, a background coding agent you can actually hand work off to. The core idea is escaping the "pseudo-micromanagement trap": instead of half-supervising automated work, you either fully offload a task or stay fully engaged. The thing that makes full offload safe is architectural: no GitHub write credentials ever enter the sandbox and network egress is tightly controlled, so a compromised agent can't phone home or reach your repos. All repository writes are replayed deterministically outside the sandbox. It runs on Modal with GitHub and Slack integration, and borrows ideas from Ramp's Inspect and OpenAI's Symphony while diverging on trust and credential handling.

Read it here: [Squire: A Sandbox Coding Agent You Can Hand the Keys To](https://bollwerk.ai/blog/squire-sandbox-agent/).
