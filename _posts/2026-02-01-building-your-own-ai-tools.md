---
layout: post
title: "Why I Built My Own AI Assistant Instead of Adopting an Omnipotent Agent"
date: 2026-02-01
permalink: /building-your-own-ai-tools
image: /assets/img/og/building-your-own-ai-tools.webp
categories:
  - "note-taking"
  - "obsidian"
  - "agentic"
excerpt: "With autonomous AI agents gaining full computer access, I went the opposite direction: a focused tool that only touches my notes. Here's why constraints might be more valuable than capabilities."
---

ClawdBot, MoltBot, Computer Use. The trend in AI tooling is clear: give the model access to everything and let it figure things out. Email, calendar, browser, terminal, file system. The pitch is compelling. Why limit what an AI can do when it could handle your entire digital life?

I went a different direction. I built an AI assistant that can only access my (work) Obsidian vault. It runs on Modal and talks to me through Telegram. It captures thoughts and turns them into permanent notes. It finds connections between ideas. It generates daily and weekly digests, pulling in my GitHub commits to recap what I actually worked on. It surfaces information when I need it and helps me manage tasks.

What it cannot do is send emails or execute arbitrary code on my machine. And I think that's a feature, not a limitation.

This isn't my only automation. I have other tools for other things, like running Claude Code from my phone. But each tool is constrained to its domain.

#### The Real Bottleneck: Cognitive Overhead

My struggle isn't that I need an AI to manage my calendar or send emails for me (at least not yet). What I actually struggle with is the gap between having an idea and that idea becoming something permanent. Voice notes pile up. Notes are scattered all over the place and go unprocessed. Meeting notes sit in limbo. The friction isn't in the tools themselves but in the cognitive overhead of organizing and connecting information.

An omnipotent agent could theoretically solve this. It could watch everything I do, infer what matters, and file things appropriately. But that solution introduces new problems. Where does the data go? What happens when the model misinterprets something sensitive? How do I audit what it's done? The attack surface expands with every capability you add. This isn't hypothetical: there's been a lot of talk about MoltBot leaking API keys and other sensitive information, to the point where [someone built a Silk Road-style marketplace for leaked MoltBot data](https://x.com/iannuttall/status/2017660254234845664).

#### Constraints as Architecture

The Obsidian bot I built has hard boundaries. It authenticates via OAuth2 to access a single Google Drive folder containing my vault. It processes messages through a Telegram webhook that only accepts requests from my user ID. It runs on Modal with `max_containers=1` to prevent abuse-driven scaling costs. The architecture looks like this:

```
Telegram → Modal Webhook → Claude Agent → Google Drive (Vault)
```

(This was in part inspired by [this post](https://www.linkedin.com/posts/activity-7421818523116625920-5NIH?utm_source=share&utm_medium=member_desktop&rcm=ACoAABkhbRsBtGyHyf5SsS8_-RYGMIEWMAecgV8))

Each component serves a specific purpose. Telegram is the input layer. Modal provides serverless execution with cost controls. Claude does the reasoning. Google Drive is the persistence layer. And since it's just files on Drive, I can still access and edit everything directly through Obsidian on my computer. There's no ambient access to my machine, no ability to "do whatever seems helpful."

This constraint shapes what the tool can be. When I send a voice note, it gets transcribed and processed according to a skill definition stored in the vault itself. The skill defines exactly what to extract, where to file it, and how to link it to existing notes. When I ask a question, Claude searches the vault using Google Drive's full-text index, reads the relevant files, and synthesizes an answer. It cannot go beyond what's in the vault because nothing else is connected.

#### Why This Matters Beyond Security

The security argument is obvious. Fewer capabilities mean fewer things that can go wrong. But there's something else at play that's harder to articulate.

I've noticed my coding skills degrading. Tasks that used to feel automatic now require more effort. Some of this is normal: you lose skills you don't practice. But I suspect part of it comes from leaning on AI for things I used to work through myself. The thinking muscle atrophies when you outsource the thinking.

Building tools that organize my thoughts rather than replace them is an attempt to resist this. The Obsidian bot doesn't decide what's important. I do, through the skill definitions and the questions I ask. It handles the mechanical work of transcription, filing, and search. The synthesis stays with me.

Maybe this is cope. Maybe in two years I'll look back at this and laugh at how I was clinging to some notion of cognitive autonomy while everyone else had their AI managing their (digital) lives. But the concern feels real: if you stop doing the hard thinking because something else does it for you, how will it affect your reasoning skills and creativity?

#### The Technical Reality

Building this took about two hours with Claude Opus. Most of it was one-shotted. Two things required iteration: switching from a Google service account to OAuth (service accounts can't write to personal Drive storage), and using Google Drive's native full-text search instead of having the agent read files one by one (which is very inefficient for large vaults).

For anyone technical enough to be reading this, the barrier to building something similar is low. Claude Code, Modal, Google Drive API, Telegram Bot API. All of these have free tiers or generous credits. The hardest part is defining what you actually want the tool to do, which forces you to think about what problem you're actually solving.

#### The Question of Accessibility

It's easy for me to say "build your own tools" because I'm a programmer. But I wonder if this approach scales. Claude Code and similar tools are lowering the bar for non-technical people to build custom software. The question is whether the learning curve is actually as low as it seems from my immersed perspective.

I don't have a good answer to this. Maybe the right frame isn't "everyone should build their own AI tools" but rather "the tools you adopt should be commensurate with the problems you have." If you genuinely need an agent with full computer access, fine. But if your actual problem is narrower, maybe a narrower tool is the right solution.

#### What I'm Not Saying

I'm not saying autonomous agents are bad or that people who use them are making a mistake. There are legitimate use cases where broad capability makes sense. If you're running a complex business operation and need an AI to coordinate across multiple systems, constraints might be counterproductive.

What I am saying is that the default shouldn't be "give the AI everything and see what happens." The default should be "what's the smallest scope that actually solves my problem?" Start constrained. Add capabilities when you hit real limitations. That way you maintain visibility into what the tool is doing and why.

#### What's Next

The Obsidian bot is still evolving. I want to add calendar integration so it can pull meeting context into daily digests. I might add email summaries at some point, though I'm wary of scope creep. The goal is to keep it focused on a single domain with clear boundaries, even as I add capabilities within that domain.

The interesting part of this setup isn't the code. It's the skill definitions that tell Claude how to process different types of input. Those are just markdown files with instructions. The power comes from being specific about what you want.

The broader point stands regardless of whether you adopt my particular solution. In a world where AI can do almost anything, the question of what you should let it do becomes important. Constraints aren't just about security. They're about maintaining clarity on what problems you're solving and keeping yourself in the loop on the thinking that matters.
