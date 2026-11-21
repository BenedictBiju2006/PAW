import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

MODEL_ID = "models/t5-small-finetuned"
DEVICE = "cpu"
tokenizer = AutoTokenizer.from_pretrained(MODEL_ID)
model = AutoModelForSeq2SeqLM.from_pretrained(MODEL_ID).to(DEVICE)
model.eval()


@torch.inference_mode()
def generate(prompt, **kwargs):
    inputs = tokenizer(prompt, return_tensors="pt").to(DEVICE)
    output = model.generate(**inputs, do_sample=False, max_new_tokens=128, **kwargs)
    return tokenizer.decode(output[0], skip_special_tokens=True)


if __name__ == "__main__":
    print("Parameters:", sum(p.numel() for p in model.parameters()))

    while True:
        prompt = input("\nInput: ")

        if prompt == "exit":
            break

        print("Output:", generate(prompt))