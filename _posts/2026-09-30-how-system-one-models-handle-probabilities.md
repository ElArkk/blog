---
layout: post
title: 'How System One Models Handle Probabilities, and What “Calibrated” Means'
permalink: /jev-probabilities-calibration
categories:
  - "agentic"
  - "machine-learning"
  - "uncertainty"
excerpt: "How Jev and the open model Laya turn a question into probabilities, what calibration does and doesn't promise, and what I found when I tested Jev and trained Laya-style models myself."
---

In [a talk a few months ago](https://www.youtube.com/watch?v=o-y1HJ6buGQ), TypeSafe's CEO argued that AI hasn't delivered the promised automation because models are trained to assist people, who still have to assess and act on their answers.

He wants AI to become a software layer, like a database or an API. TypeSafe calls this class of models [System One Models](https://typesafe.ai/blog/introducing-system-one-models-and-jev), with Jev as its first public model. Jev answers typed questions with probabilities that software can use to decide what happens next.

Predicting labels and returning probabilities have a long history. An encoder with a classification head, as in [BERT](https://aclanthology.org/N19-1423/), already turns text into probabilities over a set of labels.

LLMs can also produce typed answers. [Outlines](https://github.com/dottxt-ai/outlines), from .txt, constrains generation to allowed labels or a specified output schema. Those constraints ensure valid structure; they don't establish whether the answer is correct or its probability is calibrated.

What interests me about Jev is the possibility of using the same model for many different decisions: define the question and options in a request, without training a separate classifier for each task. [Sebastian Raschka makes a similar point](https://x.com/rasbt/status/2101672304358948992): what stands out is how broadly the model can be used, with a simple API on top. General classification itself has precedents, including [zero-shot entailment classifiers](https://aclanthology.org/D19-1404/) and [GLiClass](https://arxiv.org/abs/2508.07662).

This reminds me of tabular foundation models such as [TabPFN](https://www.nature.com/articles/s41586-024-08328-6): one pretrained model can serve many prediction tasks. TabPFN uses labelled rows from a new table as context; Jev takes a question, criteria and state. The analogy is about reusing a trained predictor across tasks, rather than a shared architecture or training method.

I see Jev's promise in making that generality practical through a fast API built around typed decisions and probabilities. Given how quickly LLMs have improved, I'd expect the capabilities of models like Jev to improve rapidly too. That makes calibration central: the same API can serve many tasks, but we still need to check whether its stated probabilities match observed accuracy on each one.

My question was how much we can trust those probabilities. My work in biology and, more recently, in a risk startup has made me interested in how we measure uncertainty and decide when we need more evidence.

TypeSafe describes Jev's probabilities as calibrated. Suppose a ticket-routing application asks Jev which team should handle a customer request, and Jev assigns the billing team a 90% probability. Can the application treat that number as a reliable estimate that billing is the correct choice?

I wanted to answer 2 questions: can we trust the probabilities, and can we improve the decisions? I tested Jev on 4,000 examples and trained my own models to compare temperature fitting, shuffled option orders and ensembles.

**Contents**

- [From a question to probabilities](#from-a-question-to-probabilities)
- [Probability and confidence](#probability-and-confidence)
- [How the probabilities are trained](#how-the-probabilities-are-trained)
- [Can we trust the reported probabilities?](#can-we-trust-the-reported-probabilities)
- [Can averaging improve the decisions?](#can-averaging-improve-the-decisions)
- [Can the ensemble identify its mistakes?](#can-the-ensemble-identify-its-mistakes)
- [What these results mean](#what-these-results-mean)

## From a question to probabilities

### What Jev does

Jev answers questions about a state. You send the state, which can be text or JSON, and one or more typed questions about it:

```json
{
  "model": "typesafe/jev-1.13",
  "state": "Customer: I was charged twice. Please send my money back.",
  "questions": {
    "team": {
      "type": "choice",
      "instructions": "Which team should handle this ticket?",
      "criteria": {"billing": "payments and refunds", "technical": "bugs and outages", "sales": "new purchases"}
    }
  }
}
```

Jev returns a probability for each option, for example `billing: 0.81, technical: 0.13, sales: 0.05` after rounding. Software could route tickets above a chosen threshold and send the rest to a person.

Alongside **Choice** questions, it supports **Score** questions with ordered levels and **Noul** questions with yes/no answers. The fixed options prevent invented answers, but Jev can still assign high probability to a wrong option, including when none fits.

### Laya, an open model with the same interface

Jev's architecture is private. [Laya](https://github.com/NandhaKishorM/laya) is an independent, open-weight model with a compatible API, built on a 421M-parameter ModernBERT encoder. Its code shows one way to produce these probabilities.

Laya reads the question, options and state together, then gives each option a score, or *logit*. It divides these scores by a fitted temperature `T` and applies softmax to produce probabilities. A temperature is fitted for a particular data distribution; it may not give calibrated probabilities on other datasets ([Ovadia et al., 2019](https://arxiv.org/abs/1906.02530)).

The interactive figure shows the steps:

{% include jev-forward-pass.html %}

Changing the option order changes the model's input, which matters when we test it below.

### Probability and confidence

Laya's `answer_confidence` is the largest option probability. Its separate `confidence` field measures how concentrated the distribution is: 1 minus normalized entropy for Choice and Score questions, or the largest probability for Noul questions.

Jev's `confidence` uses a different formula. Its docs only call it a statistic of the probabilities, but on 80 answers with 3 options it matched `(3 × p_max − 1) / 2` to within rounding. That only looks at the top probability, rescaled so a uniform answer gives 0 and a certain one gives 1.

The difference shows on answers with the same top probability:

| Probabilities | Top probability | Laya `confidence` | Jev `confidence` |
| ------------- | --------------- | ----------------- | ---------------- |
| 0.6 / 0.4 / 0 | 0.6 | 0.39 | 0.40 |
| 0.6 / 0.2 / 0.2 | 0.6 | 0.14 | 0.40 |
| 0.5 / 0.5 / 0 | 0.5 | 0.37 | 0.25 |

Laya gives the 50/50 answer more confidence than the second row. Neither `confidence` field directly states the chance of being right. For an acceptance threshold, I'd use the chosen answer's probability and check it against observed accuracy.

### How the probabilities are trained

TypeSafe trains Jev with a method it calls RLCD, reinforcement learning for calibrated decisions. Laya's open version uses the same name for its own recipe.

Rewarding the correct choice alone doesn't teach the model to match its stated confidence to how often it's right: it could always assign 99% to its chosen answer without an extra penalty for overconfidence.

A **proper scoring rule** scores the probabilities themselves: reporting the true distribution gives the best expected score. Laya uses the log of the probability assigned to the correct answer, which penalizes confident mistakes strongly.

Suppose tickets saying "I was charged twice" turn out to be billing problems 70% of the time and technical problems 30% of the time. A model reporting 70% for billing gets a better average log score than one reporting 99%, because the latter loses heavily on the technical cases.

| Reported probability of billing | 50% | 70% | 90% | 99% |
| --- | --- | --- | --- | --- |
| Average log score | −0.69 | −0.61 | −0.76 | −1.39 |

Higher is better. The corresponding error measure, log loss, reverses the sign, so lower is better. This objective encourages the reported distribution to match the true answer distribution, even when each training example has only 1 label. It doesn't guarantee calibration on new data.

<details markdown="1">
<summary>The math: why the log score rewards reporting the true distribution</summary>

#### Proper scoring rules

A scoring rule evaluates the probability distribution reported for an observed outcome. The model states probabilities $$q$$ for the options, the correct answer $$y$$ is revealed, and the rule returns a score:

$$
S(q, y)
$$

Suppose the true probabilities of the answers are $$p$$. The scoring rule is **proper** if no stated distribution scores better on average than $$p$$ itself:

$$
\mathbb{E}_{y \sim p}\big[S(q, y)\big] \;\le\; \mathbb{E}_{y \sim p}\big[S(p, y)\big] \quad \text{for every } q
$$

Stating the true probabilities is then the best strategy. Laya's main scoring rule is the log score, the log of the probability the model gave to the correct answer:

$$
S(q, y) = \log q_y
$$

99% on the correct answer scores $$\log 0.99 = -0.01$$; 1% scores $$\log 0.01 = -4.6$$.

#### Training maximizes the average score

Training adjusts the model's weights $$\theta$$ to make the average log score over all $$N$$ training examples as high as possible:

$$
\max_\theta \; \frac{1}{N} \sum_{i=1}^{N} \log q_\theta(y_i \mid x_i)
$$

Here $$x_i$$ is the $$i$$-th training input, for example a ticket, $$y_i$$ its correct answer, and $$q_\theta(y \mid x)$$ the probability the model with weights $$\theta$$ gives answer $$y$$ for input $$x$$.

#### What the objective encourages

Every label $$y_i$$ is a single answer, never a probability. But the same kind of input doesn't always have the same answer. Write $$p(y \mid x)$$ for the share of inputs like $$x$$ whose correct answer is $$y$$: the true probability of $$y$$ given $$x$$.

For a fixed model and representative samples, the average score estimates its expected value:

$$
\frac{1}{N} \sum_{i=1}^{N} \log q_\theta(y_i \mid x_i) \;\approx\; \mathbb{E}_{x}\Big[\, \sum_{y} p(y \mid x) \, \log q_\theta(y \mid x) \Big]
$$

The outer $$\mathbb{E}_x$$ averages over the inputs in the data. The inner sum is the expected log score for one input $$x$$: each answer $$y$$ contributes its score $$\log q_\theta(y \mid x)$$, weighted by how often it's the correct one. That's the expected score from the definition of a proper scoring rule, with $$p(\cdot \mid x)$$ as the true probabilities. Because the log score is proper, the inner sum is largest when $$q_\theta(\cdot \mid x) = p(\cdot \mid x)$$.

This describes the ideal population objective. A finite training set, a limited model and imperfect optimization can all prevent the trained model from reaching it. A proper scoring rule gives the right incentive; calibration still needs to be measured on held-out data.


For the ticket example, let $$q$$ be the reported probability of billing. The expected log score is

$$
0.7 \log q + 0.3 \log(1-q).
$$

It reaches its maximum at $$q = 0.7$$. Reporting 0.9 scores better on billing tickets, but the penalty on technical tickets more than cancels that gain.

</details>

<details markdown="1">
<summary>How Laya adds reinforcement learning</summary>

Laya combines the log-score objective with a reinforcement-learning term that scores small random changes to the logits. Both score the probability assigned to the correct answer, rather than just whether the model chose it.

For each training example, Laya makes several copies of the model's logits with a little random noise added. It converts each copy into probabilities and evaluates them with a proper scoring rule.

Copies that score above the group's average count as good moves, and training shifts the logits toward them. This is the "RL" in Laya's RLCD recipe.

The reward favors reporting the true answer distribution, but adding noise and estimating updates introduces another optimization step. Using a proper reward alone doesn't establish that this procedure will recover the true probabilities.

</details>

After training, Laya fits a temperature on held-out data to adjust how sharp its probabilities are.

## Can we trust the reported probabilities?

An uncertain answer and an unreliable probability are different problems. A model might correctly report a 50/50 choice because the input leaves the answer unclear, or report 99% because it has learned the wrong pattern.

Uncertainty from limits in the model or its training data is called *epistemic*; uncertainty that remains even with a correct model, given the available input, is called *aleatoric* ([Hüllermeier and Waegeman](https://arxiv.org/abs/1910.09457)). More relevant data can reduce the first; additional information about an individual case may resolve ambiguity in the second. Our tests don't cleanly measure these as separate quantities.

Calibration asks a narrower question: do the reported probabilities match the observed outcomes?

### Calibration checks the probability report

For the chosen answer, calibration means that predictions given about 80% probability are correct about 80% of the time. We measure this across many examples from a particular dataset. This doesn't tell us how precisely each individual probability is known.

A reliability diagram groups answers by stated probability and plots each group's accuracy. Calibrated predictions sit on the diagonal. Expected calibration error (ECE) averages the absolute gaps, weighted by group size; I report it in percentage points.

Temperature fitting is an established way to reduce overconfidence ([Guo et al., 2017](https://proceedings.mlr.press/v70/guo17a.html)). Divide the logits by a positive number $$T$$, chosen for the best log score on held-out labelled data. Values above 1 flatten the probabilities while preserving the highest-scoring option in the original question.

To test this, I fine-tuned the public ModernBERT-large encoder with Laya's decision head and training code on 100,000 examples from [MultiNLI (MNLI)](https://cims.nyu.edu/~sbowman/multinli/). Each example asks whether a premise supports a hypothesis, contradicts it, or leaves it open.

I evaluated the model on held-out MNLI examples and on [ANLI](https://github.com/facebookresearch/anli), which uses the same 3 labels but has examples written to fool NLI models.

The figure compares raw probabilities with temperatures fitted on separate labelled MNLI or ANLI examples.

<div class="jf" data-fig="temperature"></div>

Temperature fitting left every chosen answer unchanged on both datasets. Fitting the temperature on labelled MNLI examples reduced log loss on separate MNLI test examples from 1.69 to 0.39, with no change in accuracy.

On ANLI, the model was near chance at 34% accuracy. Fitting the temperature on separate labelled ANLI examples gave a value of about 1,200, pushing each answer's probability towards 1/3: the probabilities now reflected that the model was effectively guessing, without improving its answers.

Temperature fitting changed how the model reported its uncertainty. It didn't teach the model to answer more questions correctly or resolve missing information in the input.

A calibrated model can still be uncertain, and still make many mistakes. When stated probabilities match observed accuracy, software can use them to estimate the error rate among accepted answers.

### How well did Jev report its uncertainty?

I then checked whether Jev's probabilities matched its outcomes. I tested Jev 1.13 on 2,000 MNLI examples and 2,000 ANLI examples, with 1 example per premise in each dataset.

I first used the same option order for every example. On MNLI, the probability Jev assigned to its chosen answer was close to how often it was correct. On the harder ANLI examples, it was overconfident.

<div class="jf" data-fig="jev"></div>

On ANLI, Jev assigned 90% to 99% probability to answers that were correct only 81.9% of the time. Their average stated probability was 94.9%, so Jev overstated its accuracy in this group by 13 percentage points. Other [independent Jev tests](https://github.com/AbdelStark/jev-benchmarks#pilot-result) also report that calibration varies by task.

## Can averaging improve the decisions?

Temperature fitting can bring stated probabilities closer to observed accuracy without changing the chosen answers. Can averaging also increase the number of correct answers? I tried 2 forms of averaging: changing the option order for the same model, and combining separately trained models. The first varies the presentation; the second varies the learned model.

### Average over shuffled option orders

Jev's CTO [suggested](https://x.com/EGafni/status/2101808456097583560) asking the same question several times with the options in different orders, then averaging the probabilities for each option. For example, the probabilities for “entailment” are averaged together, whether it appeared first, second or third.

Option-order sensitivity has been documented in LLMs ([Pezeshkpour and Hruschka, 2024](https://aclanthology.org/2024.findings-naacl.130/)). I tested Jev with all 6 possible orders of the 3 options, changing nothing else. Before averaging, I checked how often reordering changed Jev's chosen answer: 1.4% of MNLI examples and 3.5% of ANLI examples, averaged over comparisons of the original order with each of the 5 other orders.

Averaging the probabilities across all 6 orders reduced log loss from 0.433 to 0.402 on MNLI and from 0.794 to 0.739 on ANLI. ECE fell from 3.5 to 3.0 percentage points on MNLI and from 10.3 to 9.9 on ANLI.

The chosen answers were about as accurate after averaging: roughly 87% on MNLI and 73% on ANLI. The small reductions in log loss and ECE came with almost no change in answer accuracy.

### Average over separately trained models

I used a 3-model ensemble as a first step to test whether averaging separately trained models could improve accuracy, calibration, or both. [Jev doesn't offer customer fine-tuning](https://docs.typesafe.ai/models#customizing-jev), so I used the open setup: 3 models trained on the same 100,000 MNLI examples, with different random seeds and shuffled option orders during training. The temperature experiment above used one of these models.

Models trained from different random starts can make different errors, which averaging may reduce. This is the established [deep ensemble approach](https://proceedings.neurips.cc/paper/2017/hash/9ef2ed4b7fd2c810847ffa5fa85bce38-Abstract.html). I compared a single model with the average of the 3 models trained with shuffled options.

A Bayesian approach would average predictions from weight settings sampled from their posterior distribution, which represents uncertainty about the weights after seeing the training data. [Izmailov et al. (2021)](https://proceedings.mlr.press/v139/izmailov21a.html) found that deep ensembles could approximate this average, although their predictions still differed from those obtained through posterior sampling.

In that study, posterior sampling improved accuracy and log loss over deep ensembles on the main image and text benchmarks, but required substantial computation. Our 3-model ensemble tests a much simpler approach to combining different learned solutions; posterior sampling is outside the scope of this post.

Alongside MNLI, I tested [SciTail](https://huggingface.co/datasets/allenai/scitail): does a web sentence support a statement built from a science exam question and answer? It has 2 labels, support or no support.

With temperatures fitted separately for the single model and the ensemble on held-out MNLI data, averaging lowered log loss from 0.39 to 0.33 on MNLI and from 0.49 to 0.46 on SciTail. Refitting temperatures on 50 labelled SciTail examples also left the ensemble ahead: median SciTail log loss was 0.454 for the single model and 0.428 for the ensemble across 10 random calibration samples.

With the MNLI-fitted temperatures, accuracy rose from 89.0% for the single model to 89.5% for the ensemble on MNLI, and from 82.6% to 83.5% on SciTail. Here, averaging produced more correct answers as well as lower log loss. The ensemble still performed near chance on ANLI.

> Training note: I first trained models with a fixed option order. Changing option order during testing then reduced one model's MNLI accuracy from 88.7% to 39.1%, which suggests it relied on option position. The ensemble results use models trained with shuffled option orders.

## Can the ensemble identify its mistakes?

Averaging improved accuracy and log loss on MNLI and SciTail. Does the ensemble also make it easier to identify mistakes than a single model? I compared the single model's answer probability with 2 scores from the ensemble:

- **Answer probability, for either system:** $$1-p_{\text{answer}}$$, where $$p_{\text{answer}}$$ is the probability assigned to that system's chosen answer. For the ensemble, I averaged the models' probabilities before temperature fitting; both systems used temperatures fitted on MNLI.
- **Disagreement:** the entropy of the models' average prediction minus the average entropy of their individual predictions. This measures the extra uncertainty from combining different predictions, using probabilities before temperature fitting.

<details markdown="1">
<summary>The disagreement formula</summary>

This is *ensemble mutual information*, also called generalized Jensen–Shannon divergence, a [standard measure of model disagreement](https://torch-uncertainty.github.io/generated/torch_uncertainty.metrics.classification.MutualInformation.html).

For the 3 models' probability distributions $$p_1,p_2,p_3$$:

$$
\bar p=\frac{p_1+p_2+p_3}{3}.
$$

$$
S_{\text{disagreement}}=
\underbrace{H(\bar p)}_{\text{entropy of the average prediction}}
-
\underbrace{\frac{H(p_1)+H(p_2)+H(p_3)}{3}}_{\text{average entropy of individual predictions}}.
$$

Entropy measures how spread out the probabilities are:

$$
H(p)=-\sum_c p_c\ln p_c,
$$

where $$c$$ runs over the answer options. Using natural logarithms gives the score in nats: 0 means identical probability distributions, and the maximum of about 1.1 means each model is certain about a different answer.

</details>

I calculated **AUROC separately for each score**: how often it ranks an incorrect answer above a correct answer, counting ties as half. A value of 0.50 means chance; 1 means perfect separation. The single-model score detects the single model's errors; both ensemble scores detect the ensemble's errors, on the same test examples.

| Dataset | Single-model probability AUROC | Ensemble probability AUROC | Ensemble disagreement AUROC |
| --- | ---: | ---: | ---: |
| MNLI | 0.834 | 0.854 | 0.846 |
| SciTail | 0.664 | 0.692 | 0.685 |
| ANLI | 0.458 | 0.444 | 0.429 |

The ensemble's answer probability identified errors better than the single model's on MNLI and SciTail. Those gains also held in a paired bootstrap of test-example groups, with the trained models fixed. On ANLI, where both systems had chance-level accuracy, none of the scores gave a useful error ranking.

The chart separates correct and incorrect ensemble answers. Use the buttons to compare model disagreement with the probability assigned to the chosen answer. Darker bands mean more disagreement or a lower answer probability.

<div class="jf" data-fig="disagreement"></div>

On MNLI and SciTail, incorrect answers tend to have more disagreement. On ANLI, that relationship reverses. Disagreement is a useful warning on the first 2 datasets, but the table shows that the ensemble's answer probability works slightly better; the gap between those 2 ensemble scores on SciTail was uncertain when I resampled the test data.

Disagreement can miss uncertainty shared by all the models. The ensemble's answer probability captures that too, which helps explain why disagreement may not be the better error score. Calculating either score still requires all 3 models.

If the ensemble knew the true answer probabilities, its chance of a mistake would be exactly $$1-p_{\text{answer}}$$. Ranking by that error probability is optimal for selecting answers to accept ([Franc et al., 2023](https://www.jmlr.org/papers/v24/21-0048.html)); low ECE alone doesn't establish that the estimated probabilities meet this condition.

[Jaeger et al. (2023)](https://arxiv.org/abs/2211.15259) also found no general advantage for entropy-based scores over averaged answer probability in an image-classification study using Monte Carlo dropout. [Gleave and Irving](https://arxiv.org/abs/2203.07472) found a weak relationship between ensemble uncertainty and error in language reward models, and suggested shared pretraining as a possible cause.

## What these results mean

Jev's appeal is the prospect of using one model for many decisions, with the question and possible answers defined in each request. That brings the CEO's proposed software layer within reach: developers can add a prediction to an application without first building a separate classifier. The probabilities then become part of how the application decides when to act.

The tests separated 3 outcomes: choosing more correct answers, matching stated probabilities to observed accuracy, and identifying likely mistakes. Temperature fitting adjusted how certain a model sounded without changing its choices. Averaging Jev's predictions across shuffled option orders slightly reduced log loss and calibration error on both datasets, with almost no change in accuracy. Averaging separately trained models improved both log loss and accuracy on MNLI and SciTail.

The ensemble also identified its errors better than the single model on MNLI and SciTail when using answer probability as the error score. Disagreement helped flag mistakes too, but the ensemble's answer probability worked slightly better. Agreement alone could still hide mistakes shared by all the models.

Averaging across option orders required 6 Jev calls per question for small reductions in log loss and calibration error, with almost no change in accuracy. The ensemble required 3 fine-tuning runs and 3 model evaluations per question, but increased accuracy and improved error detection on MNLI and SciTail. Whether those gains justify the added compute depends on the workload and the cost of mistakes.

A probability should help us decide how much to trust an answer. These tests show why that takes more than checking accuracy: a model can choose the right answer often and still overstate its certainty, or be well calibrated while doing little better than guessing.

To act on its probabilities, we need to know both how often it is right and how confidently it is wrong.

<!-- links: code repo, interactive explainer, results -->

{% include jev-figures.html %}
{% include katex.html %}
