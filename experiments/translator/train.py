
import argparse
import json
import random
from pathlib import Path

import torch
from torch.utils.data import DataLoader, Dataset
from tqdm import tqdm
from transformers import AutoModelForSeq2SeqLM, AutoTokenizer


MODEL_ID = "google/flan-t5-small"


class TranslationDataset(Dataset):
    def __init__(self, examples):
        self.examples = examples

    def __len__(self):
        return len(self.examples)

    def __getitem__(self, index):
        return self.examples[index]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", default="data/paw_translator_12000.jsonl")
    parser.add_argument("--output", default="models/t5-small-finetuned")
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--batch-size", type=int, default=8)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    args = parser.parse_args()

    random.seed(42)
    torch.manual_seed(42)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_ID, use_fast=True)
    model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID).to(device)

    with open(args.data, encoding="utf-8") as file:
        examples = [json.loads(line) for line in file if line.strip()]

    random.shuffle(examples)
    split = int(len(examples) * 0.9)
    training_examples = examples[:split]
    validation_examples = examples[split:]

    def collate(batch):
        inputs = tokenizer([example["input"] for example in batch], padding=True, truncation=True, max_length=128, return_tensors="pt")
        labels = tokenizer(text_target=[example["output"] for example in batch], padding=True, truncation=True, max_length=64, return_tensors="pt").input_ids
        labels[labels == tokenizer.pad_token_id] = -100
        inputs["labels"] = labels
        return inputs

    train_loader = DataLoader(TranslationDataset(training_examples), batch_size=args.batch_size, shuffle=True, collate_fn=collate)
    validation_loader = DataLoader(TranslationDataset(validation_examples), batch_size=args.batch_size, collate_fn=collate)

    optimizer = torch.optim.AdamW(model.parameters(), lr=args.learning_rate)
    best_validation_loss = float("inf")

    print(f"Device: {device}")
    print(f"Training examples: {len(training_examples)}")
    print(f"Validation examples: {len(validation_examples)}")
    print(f"Parameters: {sum(p.numel() for p in model.parameters()):,}")

    for epoch in range(args.epochs):
        model.train()
        total_training_loss = 0

        progress = tqdm(train_loader, desc=f"Epoch {epoch + 1}/{args.epochs}")

        for batch in progress:
            batch = {key: value.to(device) for key, value in batch.items()}

            optimizer.zero_grad()
            loss = model(**batch).loss
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()

            total_training_loss += loss.item()
            progress.set_postfix(loss=f"{loss.item():.4f}")

        model.eval()
        total_validation_loss = 0

        with torch.inference_mode():
            for batch in validation_loader:
                batch = {key: value.to(device) for key, value in batch.items()}
                total_validation_loss += model(**batch).loss.item()

        training_loss = total_training_loss / len(train_loader)
        validation_loss = total_validation_loss / len(validation_loader)

        print(f"Epoch {epoch + 1}: train_loss={training_loss:.4f}, val_loss={validation_loss:.4f}")

        if validation_loss < best_validation_loss:
            best_validation_loss = validation_loss
            Path(args.output).mkdir(parents=True, exist_ok=True)
            model.save_pretrained(args.output, safe_serialization=True)
            tokenizer.save_pretrained(args.output)
            print(f"Saved best model to {args.output}")

    print("Training complete.")


if __name__ == "__main__":
    main()
