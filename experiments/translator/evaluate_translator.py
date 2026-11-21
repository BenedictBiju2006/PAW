import argparse
import csv
import json
import re
from collections import defaultdict
from pathlib import Path
from time import perf_counter

import torch
from tqdm import tqdm
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer


MODEL_PATHS = {
    "baseline": "google/flan-t5-small",
    "finetuned": "models/t5-small-finetuned",
}
ACTIONS = ("create", "update", "delete")
TARGETS = ("collection", "record", "interface")
NAME_PATTERN = re.compile(r'"([^"\n]+)"')
OUTPUT_PATTERN = re.compile(r'^(create|update|delete) (collection|record|interface) "([^"\n]+)"$')


def load_examples(path):
    with Path(path).open(encoding="utf-8") as file:
        examples = [json.loads(line) for line in file if line.strip()]

    for index, example in enumerate(examples):
        if not isinstance(example.get("input"), str) or not isinstance(example.get("output"), str):
            raise ValueError(f"Example {index} must contain string input and output fields")
        example["index"] = index
        example["category"] = example.get("category", "unspecified")
        expected = example["output"].strip()
        if expected != "unsupported":
            match = OUTPUT_PATTERN.fullmatch(expected)
            if not match:
                raise ValueError(f"Invalid expected output at example {index}: {expected}")
            if match.group(3) not in NAME_PATTERN.findall(example["input"]):
                raise ValueError(f"Expected name absent from input at example {index}: {expected}")

    return examples


def batches(items, size):
    for index in range(0, len(items), size):
        yield items[index:index + size]


def build_trie(tokenizer, names):
    trie = {}
    for name in dict.fromkeys(names):
        for action in ACTIONS:
            for target in TARGETS:
                sequence = tokenizer.encode(f'{action} {target} "{name}"', add_special_tokens=False)
                sequence.append(tokenizer.eos_token_id)
                node = trie
                for token_id in sequence:
                    node = node.setdefault(token_id, {})
    return trie


def decode_batch(model, tokenizer, examples, device, mode, max_input_tokens, max_output_tokens):
    encoded = tokenizer([example["input"] for example in examples], padding=True, truncation=True, max_length=max_input_tokens, return_tensors="pt").to(device)
    options = {"do_sample": False, "num_beams": 1, "max_new_tokens": max_output_tokens}

    if mode == "constrained":
        tries = [build_trie(tokenizer, NAME_PATTERN.findall(example["input"])) for example in examples]
        if any(not trie for trie in tries):
            raise ValueError("Constrained generation requires at least one quoted name per example")

        def allowed_tokens(batch_id, decoder_ids):
            node = tries[batch_id]
            for token_id in decoder_ids.tolist()[1:]:
                if token_id == tokenizer.eos_token_id:
                    if token_id not in node:
                        raise RuntimeError(f"Unexpected EOS for item {batch_id}")
                    return [tokenizer.pad_token_id]
                node = node.get(token_id)
                if node is None:
                    raise RuntimeError(f"Decoder left allowed output language for item {batch_id}")
            if not node:
                return [tokenizer.pad_token_id]
            return list(node)

        options["prefix_allowed_tokens_fn"] = allowed_tokens
        longest = max(max(len(tokenizer.encode(f'{a} {t} "{n}"', add_special_tokens=False)) + 1 for n in NAME_PATTERN.findall(example["input"]) for a in ACTIONS for t in TARGETS) for example in examples)
        options["max_new_tokens"] = max(max_output_tokens, longest)

    with torch.inference_mode():
        sequences = model.generate(**encoded, **options)

    return tokenizer.batch_decode(sequences, skip_special_tokens=True)


def score(expected, prediction):
    expected = expected.strip()
    prediction = prediction.strip()
    result = {"exact": int(expected == prediction), "action": None, "target": None, "name": None, "valid": None}
    if expected == "unsupported":
        return result

    truth = OUTPUT_PATTERN.fullmatch(expected)
    candidate = OUTPUT_PATTERN.fullmatch(prediction)
    result["valid"] = int(candidate is not None)
    for position, field in enumerate(("action", "target", "name"), start=1):
        result[field] = int(candidate is not None and truth.group(position) == candidate.group(position))
    return result


def aggregate(results):
    counts = defaultdict(lambda: {"total": 0, "correct": 0, "supported": 0, "unsupported": 0, "valid": 0, "action": 0, "target": 0, "name": 0})
    for row in results:
        for group in ("overall", row["category"]):
            item = counts[group]
            item["total"] += 1
            item["correct"] += row["exact"]
            if row["expected"] == "unsupported":
                item["unsupported"] += 1
            else:
                item["supported"] += 1
                for field in ("valid", "action", "target", "name"):
                    item[field] += row[field]

    return {
        group: {
            "examples": item["total"],
            "exact_match": round(item["correct"] / item["total"] * 100, 2),
            "supported_examples": item["supported"],
            "unsupported_examples": item["unsupported"],
            "valid_format": round(item["valid"] / item["supported"] * 100, 2) if item["supported"] else None,
            "action_accuracy": round(item["action"] / item["supported"] * 100, 2) if item["supported"] else None,
            "target_accuracy": round(item["target"] / item["supported"] * 100, 2) if item["supported"] else None,
            "name_accuracy": round(item["name"] / item["supported"] * 100, 2) if item["supported"] else None,
            "rejection_accuracy": round(sum(row["exact"] for row in results if (group == "overall" or row["category"] == group) and row["expected"] == "unsupported") / item["unsupported"] * 100, 2) if item["unsupported"] else None,
        }
        for group, item in counts.items()
    }


def evaluate(model, tokenizer, examples, device, mode, batch_size, max_input_tokens, max_output_tokens):
    selected = [example for example in examples if mode == "unconstrained" or example["output"].strip() != "unsupported"]
    results = []
    start = perf_counter()

    for batch in tqdm(list(batches(selected, batch_size)), desc=mode):
        predictions = decode_batch(model, tokenizer, batch, device, mode, max_input_tokens, max_output_tokens)
        for example, prediction in zip(batch, predictions):
            expected = example["output"].strip()
            results.append({"index": example["index"], "category": example["category"], "input": example["input"], "expected": expected, "prediction": prediction.strip(), "mode": mode, **score(expected, prediction)})

    return results, round(perf_counter() - start, 3)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data/paw_translator_test_2000.jsonl")
    parser.add_argument("--finetuned", default=MODEL_PATHS["finetuned"])
    parser.add_argument("--output", default="results/translator_eval")
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--max-input-tokens", type=int, default=128)
    parser.add_argument("--max-output-tokens", type=int, default=64)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--mode", choices=["both", "constrained", "unconstrained"], default="both")
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    args = parser.parse_args()

    examples = load_examples(args.data)
    if args.limit:
        examples = examples[:args.limit]
    device = "cuda" if args.device == "auto" and torch.cuda.is_available() else "cpu" if args.device == "auto" else args.device
    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)
    predictions = []
    summary = {"dataset": str(args.data), "device": device, "models": {}}
    modes = ("unconstrained", "constrained") if args.mode == "both" else (args.mode,)

    for model_name, model_path in (("baseline", MODEL_PATHS["baseline"]), ("finetuned", args.finetuned)):
        print(f"\nLoading {model_name}: {model_path}")
        tokenizer = AutoTokenizer.from_pretrained(model_path, use_fast=True)
        model = AutoModelForSeq2SeqLM.from_pretrained(model_path).to(device).eval()
        summary["models"][model_name] = {}

        for mode in modes:
            results, duration = evaluate(model, tokenizer, examples, device, mode, args.batch_size, args.max_input_tokens, args.max_output_tokens)
            for result in results:
                result["model"] = model_name
            predictions.extend(results)
            metrics = aggregate(results)
            summary["models"][model_name][mode] = {"seconds": duration, "groups": metrics}
            overall = metrics["overall"]
            print(f"{model_name} / {mode}: n={overall['examples']}, exact={overall['exact_match']:.2f}%, action={overall['action_accuracy']}, target={overall['target_accuracy']}, name={overall['name_accuracy']}, time={duration:.1f}s")

        del model
        if device == "cuda":
            torch.cuda.empty_cache()

    with (output / "predictions.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=["model", "mode", "index", "category", "input", "expected", "prediction", "exact", "valid", "action", "target", "name"])
        writer.writeheader()
        writer.writerows(predictions)

    aggregate_rows = []
    for model_name, model_results in summary["models"].items():
        for mode, mode_results in model_results.items():
            for category, metrics in mode_results["groups"].items():
                aggregate_rows.append({"model": model_name, "mode": mode, "category": category, "seconds": mode_results["seconds"], **metrics})

    with (output / "aggregates.csv").open("w", encoding="utf-8", newline="") as file:
        writer = csv.DictWriter(file, fieldnames=list(aggregate_rows[0]))
        writer.writeheader()
        writer.writerows(aggregate_rows)

    (output / "summary.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")

    print("\nHead-to-head exact match:")
    for mode in modes:
        baseline = summary["models"]["baseline"][mode]["groups"]["overall"]["exact_match"]
        finetuned = summary["models"]["finetuned"][mode]["groups"]["overall"]["exact_match"]
        print(f"{mode:<16} baseline={baseline:6.2f}%  finetuned={finetuned:6.2f}%  delta={finetuned - baseline:+6.2f} pp")

    print(f"\nSaved: {output / 'predictions.csv'}")
    print(f"Saved: {output / 'aggregates.csv'}")
    print(f"Saved: {output / 'summary.json'}")
    print("Unsupported rows are evaluated only without constraints; the current grammar has no rejection branch.")
    print("Constrained generation uses a finite prefix trie equivalent to the current single-operation, input-dependent grammar.")


if __name__ == "__main__":
    main()
