---
layout: post
title: "Running OpenCode with Self-Hosted Ollama on Modal"
date: 2026-01-12
permalink: /ollama-on-modal-for-opencode
categories:
  - "python"
  - "infra"
  - "agentic"
excerpt: "A missing newline character broke my agentic coding setup for hours. Here's how I debugged a subtle SSE streaming bug while self-hosting Ollama on Modal for OpenCode — plus the full deployment setup."
---

I wanted to run [OpenCode](https://opencode.ai) with a self-hosted LLM. [Ollama](https://ollama.com) on [Modal](https://modal.com) seemed perfect - fast spin-up, no idle costs, pay for what you use.

It took longer than expected.

This post covers the debugging journey first, then the working setup. If you just want the solution, [skip to The Working Setup](#the-working-setup).

#### The Setup

You can't just expose Ollama directly on Modal. Modal does offer [Proxy Auth Tokens](https://modal.com/docs/guide/webhook-proxy-auth) with stable URLs, but they use custom headers — not the standard Bearer token that OpenCode expects. Ollama itself has [no built-in authentication](https://github.com/ollama/ollama/issues/8536) either. So I built a FastAPI layer: stable URL, Bearer token auth, proxying requests to Ollama. But when you proxy a streaming API, you have to pass the output through correctly. That's where things went wrong.

The architecture:

```
OpenCode Client
    ↓ (HTTPS, streaming)
Modal FastAPI (authentication layer)
    ↓ (localhost)
Ollama container with GPU
```

Modal runs Ollama in a container with an H100. A FastAPI app handles auth and proxies requests to Ollama's OpenAI-compatible `/v1/chat/completions` endpoint.

#### The Problem

Everything looked correct. The API responded. Tool calls were formatted properly. But OpenCode kept looping:

```
ERROR service=acp-command promise={} reason=NotFoundError Unhandled rejection
```

The conversation history never grew past `['system', 'user']`. The client would send a request, get a response, then... send the exact same request again. Infinite loop.

#### The Investigation

For hours, I kept checking everything: Was the tool call format correct? Did the message structure exactly match the OpenAI spec? Were the response headers right? Was I using streaming mode (a must for OpenCode) rather than basic responses? Every detail seemed fine, but nothing worked.

The API logs showed successful responses. Ollama was doing its job. Something was wrong with how the response reached the client.

My streaming proxy code, the part of the FastAPI layer that forwards Ollama's response chunks to the client:

```python
async for line in response.aiter_lines():
    if line:
        yield f"{line}\n"
```

I gave Opus 4.5 the Ollama source repo, and it found the correct SSE (Server-Sent Events) format in there immediately, spotting the bug Sonnet had missed: SSE requires **two** newlines between events:

```
data: {"chunk": 1}\n\n
data: {"chunk": 2}\n\n
data: [DONE]\n\n
```

But `aiter_lines()` strips trailing newlines. Adding one back gave:

```
data: {"chunk": 1}\n
data: {"chunk": 2}\n
```

OpenCode's SSE parser couldn't find event boundaries. It saw garbage, threw `NotFoundError`, and retried.


#### The Fix

Don't process lines. Pass through raw bytes:

```python
async for chunk in response.aiter_bytes():
    yield chunk
```

That's it. Ollama's output is already properly formatted SSE. Just proxy it unchanged.

### The Working Setup

#### Modal Deployment

Deploy Ollama with a FastAPI authentication wrapper. The full code is available as a gist:

**[ollama_api.py](https://gist.github.com/ElArkk/1a459556df6b465dcdcd31e3f087c93a)**

Key points:
- FastAPI runs inside the Ollama container (same process, localhost access)
- `aiter_bytes()` preserves SSE format exactly
- Bearer token auth via Modal secrets
- H100 GPU with 300s scaledown window

Deploy:
```bash
modal secret create modal-api-key MODAL_API_KEY=your-secret-key
modal deploy ollama_api.py
modal run ollama_api.py::pull_model --model-name qwen3-coder:30b
```

**Note:** The API key can be anything you want, you define it when creating the Modal secret. It's just a shared secret between your client and your deployment.

#### OpenCode Config

Add to your `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "modal-ollama": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "Modal Ollama",
      "options": {
        "baseURL": "https://YOUR-MODAL-URL/v1",
        "num_ctx": "65536" # default Ollama context size is too small
      },
      "models": {
        "qwen3-coder:30b": { # direct ollama model
          "name": "Qwen 3 Coder 30B",
          "tool_call": true,
          "reasoning": true,
          "limit": {
            "context": 256000,
            "output": 64000
          }
        },
        "hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q8_K_XL": { # hugging face model
          "name": "Qwen 3 Coder 30B A3B Q8 HF",
          "tool_call": true,
          "reasoning": true,
          "limit": {
            "context": 256000,
            "output": 64000
          },
      }
    }
  }
}
```

Then in OpenCode, run `/connect`, select "Modal Ollama", and enter your API key when prompted.

**Note:** I'm not certain the context and output limits I've set are optimal. Experiment with these values for your use case.

**Note:** I tried Llama 3.2 3B but it doesn't work well with OpenCode. The model just can't handle tool calling reliably. Stick with larger models like Qwen3-Coder-30B for agentic coding.

#### Using Hugging Face Models

Ollama can pull GGUF models directly from Hugging Face.

To find the pull command:
1. Go to the model page (e.g., [unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF](https://huggingface.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF))
2. Click "Use this model"
3. Click "Ollama"
4. Copy the command

For example:
```bash
modal run ollama_api.py::pull_model --model-name hf.co/unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF:Q8_K_XL
```

Then add it to your OpenCode config as shown above.

#### Bonus: Full Visibility

One underrated benefit of self-hosting: you can see everything. Every prompt, every tool call, every response - the complete interaction between the agentic harness and the model.

You'll need to add logging statements to the Modal deployment to capture this (e.g., print the request body before forwarding to Ollama), but once you do, it's all there.

OpenCode is open source so you could read the code, but watching it live is different. You see exactly how it constructs prompts, handles tool responses, and iterates. It's a great way to understand how agentic coding assistants actually work.

Claude Code and other hosted solutions don't give you this visibility. With your own deployment, there's no black box.

#### Cost

Modal charges per-second for GPU time. An H100 runs $3.95/hour, with options ranging from T4 at $0.59/hour up to B200 at $6.25/hour.

Running Qwen3-Coder-30B on an H100:
- No idle costs with 300s scaledown window
- You only pay while the model is actually running
- Much cheaper than hosted APIs for heavy usage

**Rightsizing**: You could optimize by choosing a smaller GPU for your model. A 30B model might run fine on an A100 or L40S. Experiment to find the best price/performance for your needs.

**Storage**: Model weights are stored on Modal volumes. Storage is currently free, but Modal will soon start charging (similar to AWS pricing). For a 30B Q8 model (~30GB), expect a few dollars per month once pricing kicks in.

**Model loading time**: Switching models or cold-starting takes between 30 secs to 2 minutes to load weights into VRAM (17GB for Qwen3-Coder-30B). Ollama unloads models after 5 minutes of inactivity by default. You can increase this with `OLLAMA_KEEP_ALIVE=30m` in the environment config, or pre-load your preferred model at container start.

#### What's Next

If you want to go beyond OpenCode and build your own agentic workflows with Ollama on Modal, check out [modal-agents](https://github.com/bollwerkio/modal-agents), a minimal template combining PocketFlow for orchestration with GPU-accelerated Ollama and private networking.

