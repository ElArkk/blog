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

I see Jev's promise in making that generality practical through a fast API built around typed decisions and probabilities. That also makes probability quality central: the same API can serve many tasks, but we still need to know what its numbers mean on each one.

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

Rewarding the correct choice alone doesn't teach probability quality: the model could always assign 99% to its chosen answer without an extra penalty for overconfidence.

A **proper scoring rule** scores the probabilities themselves: reporting the true distribution gives the best expected score. Laya uses the log of the probability assigned to the correct answer, which penalizes confident mistakes strongly.

Suppose tickets saying "I was charged twice" turn out to be billing problems 70% of the time and technical problems 30% of the time. A model reporting 70% for billing gets a better average log score than one reporting 99%, because the latter loses heavily on the technical cases.

| Reported probability of billing | 50% | 70% | 90% | 99% |
| --- | --- | --- | --- | --- |
| Average log score | −0.69 | −0.61 | −0.76 | −1.39 |

Higher is better. The corresponding error measure, log loss, reverses the sign, so lower is better. This objective encourages accurate probabilities even when each training example has only 1 label; it doesn't guarantee calibration on new data.

<details markdown="1">
<summary>The math: why the log score rewards accurate probabilities</summary>

#### Proper scoring rules

A scoring rule measures how good a prediction was. The model states probabilities $$q$$ for the options, the correct answer $$y$$ is revealed, and the rule returns a score:

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

Laya combines the log-score objective with a reinforcement-learning term that scores small random changes to the logits. Both use probability quality as the training signal.

For each training example, Laya makes several copies of the model's logits with a little random noise added. It converts each copy into probabilities and evaluates them with a proper scoring rule.

Copies that score above the group's average count as good moves, and training shifts the logits toward them. This is the "RL" in Laya's RLCD recipe.

The reward favors accurate probability reports, but adding noise and estimating updates introduces another optimization step. Using a proper reward alone doesn't establish that this procedure will recover the true probabilities.

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

On ANLI, accuracy stayed near chance at 34%. Applying the MNLI-fitted temperature made the model less certain about its mistakes, which reduced log loss from 10.39 to 1.85. It still assigned its chosen answers an average probability of 84%, leaving ECE at about 51 percentage points.

With 3 possible answers, random guessing would be correct about 1/3 of the time, close to this model's 34% accuracy on ANLI. Fitting the temperature on separate labelled ANLI examples gave a very high value, about 1,200.

Dividing the logits by such a large number makes them nearly equal, so softmax assigns about 1/3 probability to each answer. ECE fell below 1 percentage point because those probabilities matched the model's chance-level accuracy, while its chosen answers stayed unchanged.

Temperature fitting changed how the model reported its uncertainty. It didn't teach the model to answer more questions correctly or resolve missing information in the input.

A calibrated model can still be uncertain, and still make many mistakes. Better probabilities can nevertheless help software decide which answers to accept and which to send for review.

### How well did Jev report its uncertainty?

I then checked whether Jev's probabilities matched its outcomes. I tested Jev 1.13 on 2,000 MNLI examples and 2,000 ANLI examples, with 1 example per premise in each dataset.

I first used the same option order for every example. On MNLI, the probability Jev assigned to its chosen answer was close to how often it was correct. On the harder ANLI examples, it was overconfident.

<div class="jf" data-fig="jev"></div>

On ANLI, Jev assigned 90% to 99% probability to answers that were correct only 81.9% of the time. Their average stated probability was 94.9%, so Jev overstated its accuracy in this group by 13 percentage points. Other [independent Jev tests](https://github.com/AbdelStark/jev-benchmarks#pilot-result) also report probability quality that varies by task.

## Can averaging improve the decisions?

If calibration makes the probabilities more accurate without fixing the answers, what can improve the answers themselves? I tried 2 forms of averaging: changing the option order for the same model, and combining separately trained models. The first varies the presentation; the second varies the learned model.

### Average over shuffled option orders

Jev's CTO [suggested](https://x.com/EGafni/status/2101808456097583560) asking the same question several times with the options in different orders, then averaging the probabilities for each option. For example, the probabilities for “entailment” are averaged together, whether it appeared first, second or third.

Option-order sensitivity has been documented in LLMs ([Pezeshkpour and Hruschka, 2024](https://aclanthology.org/2024.findings-naacl.130/)). I tested Jev with all 6 possible orders of the 3 options, changing nothing else. Before averaging, I checked how often reordering changed Jev's chosen answer: 1.4% of MNLI examples and 3.5% of ANLI examples, averaged over comparisons of the original order with each of the 5 other orders.

Averaging the probabilities across all 6 orders reduced log loss from 0.433 to 0.402 on MNLI and from 0.794 to 0.739 on ANLI. ECE fell from 3.5 to 3.0 percentage points on MNLI and from 10.3 to 9.9 on ANLI.

The chosen answers were about as accurate after averaging: roughly 87% on MNLI and 73% on ANLI. Here, the gain was in the probability report, with little change in overall accuracy.

### Average over separately trained models

Could averaging separately trained models help more? [Jev doesn't offer customer fine-tuning](https://docs.typesafe.ai/models#customizing-jev), so I used the open setup: 3 models trained on the same 100,000 MNLI examples, with different random seeds and shuffled option orders during training. The temperature experiment above used one of these models.

Models trained from different random starts can make different errors, which averaging may reduce. This is the established [deep ensemble approach](https://proceedings.neurips.cc/paper/2017/hash/9ef2ed4b7fd2c810847ffa5fa85bce38-Abstract.html). I compared a single model with the average of the 3 models trained with shuffled options.

Alongside MNLI, I tested [SciTail](https://huggingface.co/datasets/allenai/scitail): does a web sentence support a statement built from a science exam question and answer? It has 2 labels, support or no support.

With temperatures fitted separately for the single model and the ensemble on held-out MNLI data, averaging lowered log loss from 0.39 to 0.33 on MNLI and from 0.49 to 0.46 on SciTail. Refitting temperatures on 50 labelled SciTail examples also left the ensemble ahead: median SciTail log loss was 0.454 for the single model and 0.428 for the ensemble across 10 random calibration samples.

With the MNLI-fitted temperatures, accuracy rose from 89.0% for the single model to 89.5% for the ensemble on MNLI, and from 82.6% to 83.5% on SciTail. Averaging different models can change the chosen answer, so it can improve the decision itself as well as the probabilities. The ensemble still performed near chance on ANLI.

> Training note: I first trained models with a fixed option order. Changing option order during testing then reduced one model's MNLI accuracy from 88.7% to 39.1%, which suggests it relied on option position. The ensemble results use models trained with shuffled option orders.

## Can the ensemble identify its mistakes?

The ensemble improved some predictions. I also wanted to know whether its members' disagreement could identify the answers that still needed human review. Better average predictions and better error detection are separate benefits.

Disagreement is measured in nats, a unit of information: 0 means all 3 models assign identical probabilities, while the maximum of about 1.1 means each model is certain about a different answer.

<details markdown="1">
<summary>How disagreement is calculated</summary>

I measured disagreement by comparing the uncertainty in the average prediction with the average uncertainty of the individual models. For the 3 models, the formula is:

$$
D = H(\bar p) - \frac{H(p_1) + H(p_2) + H(p_3)}{3},
\qquad
\bar p = \frac{p_1+p_2+p_3}{3}.
$$

Here, $$p_i$$ is model $$i$$'s probability distribution over the options, and $$\bar p$$ is their average. $$H$$ is entropy, which measures how spread out a probability distribution is:

$$
H(p) = -\sum_c p_c\ln(p_c).
$$

The sum runs over the answer options; a zero-probability option contributes 0. Because the formula uses the natural logarithm, $$\ln$$, its unit is **nats**. The disagreement score is a measure of information, not a probability of being wrong.

If all 3 models give identical probabilities, $$D=0$$, even if each model is uncertain. If each model is certain about a different answer, their average is spread evenly over the 3 options and $$D=\ln(3)\approx1.10$$ nats, the maximum here.

I calculated this score from the models' probabilities before temperature fitting.

</details>

Each pair of bars below compares correct and incorrect ensemble answers. Darker sections mean more disagreement; a useful error signal would give the incorrect-answer bar a larger dark section.

<div class="jf" data-fig="disagreement"></div>

On MNLI, incorrect answers tend to have more disagreement. On ANLI, the pattern reverses: the models often agree on a wrong answer.

AUROC measures how often a randomly chosen incorrect answer has more disagreement than a randomly chosen correct answer, with ties counting half. It's 0.85 on MNLI, 0.69 on SciTail and 0.43 on ANLI; 0.50 means chance.

Disagreement identified errors better on the datasets where the ensemble was more accurate: MNLI, then SciTail, then ANLI. A plausible explanation is that the models learned useful patterns on MNLI but shared more of their mistakes on unfamiliar inputs.

Higher accuracy alone doesn't guarantee better error detection from disagreement. Even highly accurate models can agree on every mistake, giving disagreement no way to separate correct and incorrect answers. ANLI's chance-level accuracy was already clear; this comparison asks whether disagreement could flag its errors, and here it couldn't.

There are 2 comparisons here. First, I compared using 1 model with using all 3 models together. Averaging their predictions improved log loss, as shown above.

The second comparison used the same ensemble in both cases. For each option, I averaged the probability assigned by each of the 3 models, then applied the fitted temperature. The ensemble chose the option with the largest resulting probability.

I then tried 2 ways to identify mistakes in those chosen answers:

- **Use the ensemble's answer probability.** The error score is **1 minus the probability assigned to its chosen answer**: an answer given 90% probability gets a score of 0.10. Higher scores flag answers as more likely to be wrong. This applies the standard [answer-probability baseline](https://arxiv.org/abs/1610.02136) to the ensemble.
- **Use disagreement between the models.** First, calculate entropy, a measure of how spread out the probabilities are, for each model and average those 3 entropy values. Then calculate the entropy of the models' average probability distribution and subtract the first value. This measures how much extra uncertainty appears when we combine their different predictions, using probabilities before temperature fitting.

For example, if each model is certain about a different answer, each has zero entropy, but their average assigns 1/3 to every answer. All the uncertainty in that average comes from disagreement. If all 3 models already assign 1/3 to every answer, averaging adds no uncertainty, so disagreement is zero.

To compare the 2 scores, I kept the ensemble's chosen answers fixed and marked each as correct or incorrect using the test labels. Each answer then had 2 error scores: 1 minus its answer probability, and its disagreement score. For both, a higher value means a stronger warning of an error.

I calculated AUROC separately for each score, using the same correct and incorrect answers. For every pair containing one incorrect answer and one correct answer, the score earns 1 if it ranks the incorrect answer higher, 0.5 for a tie, and 0 if it ranks the correct answer higher. AUROC is the average across those pairs.

An AUROC of 0.85 therefore means the score puts the incorrect answer first in 85% of these comparisons, counting ties as half. It doesn't mean 85% of answers are correct. Because AUROC uses the ranking, we can compare the probability-based score with disagreement in nats without converting their units.

Using the ensemble's answer probability gave slightly higher AUROC on all 3 datasets. The gaps were small, and the SciTail gap was uncertain when I resampled the test data. On ANLI, both scores ranked errors worse than chance, so the small advantage didn't make either a useful warning signal there.

There is a reason to expect answer probability to work well. If all 3 models give each option a probability of 1/3, they have zero disagreement, but their chosen answer still has only 1/3 probability. Disagreement misses uncertainty that the models share.

If the ensemble knew the true answer probabilities for each input, the chance of a mistake would be exactly 1 minus the probability of its chosen answer. Ranking by that error probability is optimal for selecting which answers to accept ([Franc et al., 2023](https://www.jmlr.org/papers/v24/21-0048.html)). Real model probabilities are estimates; a low ECE alone doesn't establish this stronger condition.

The comparison is therefore worth testing, but the outcome isn't surprising. [Jaeger et al. (2023)](https://arxiv.org/abs/2211.15259) also found no general advantage for entropy-based uncertainty scores over averaged answer probability in their image-classification study, which used Monte Carlo dropout. Our result supports the ensemble's combined prediction as an error score; calculating it still requires all 3 models.

The models share a pretrained encoder and training data, so they can share weaknesses that disagreement doesn't reveal. [Gleave and Irving](https://arxiv.org/abs/2203.07472) also found a weak relationship between ensemble uncertainty and error in language reward models, using different measures, and suggested shared pretraining as a possible cause.

## What these results mean

Jev's appeal is the prospect of using one model for many decisions, with the question and possible answers defined in each request. That brings the CEO's proposed software layer within reach: developers can add a prediction to an application without first building a separate classifier. The probabilities then become part of how the application decides when to act.

The tests helped me separate improving those probability reports from improving the answers. Temperature fitting adjusted how certain a model sounded without changing its choices, and averaging Jev's shuffled inputs mostly improved its probabilities. Averaging separately trained models improved both log loss and accuracy on MNLI and SciTail.

The ensemble also gave useful signals for identifying errors on those datasets. Its answer probability worked at least as well as disagreement between its members, so the combined prediction was the most useful output in this comparison. Agreement alone could still hide mistakes shared by all the models.

Getting that ensemble required open weights, labelled training data and several fine-tuning runs, followed by running several models for each prediction. Jev makes the first prediction much easier to obtain; an open model gives me more control over how to improve it. Averaging shuffled Jev requests is an accessible option, but our tests found little change in answer accuracy.

This brings me back to the question that interests me in biology and risk: when does the evidence justify acting? For Jev's promised automation, I'd want to know how often the answers my software accepts are wrong, measured on its actual workload. That measured error rate, together with the cost of a mistake, is what would determine how much authority I'd give it.

<!-- links: code repo, interactive explainer, results -->

{% include jev-figures.html %}
{% include katex.html %}
