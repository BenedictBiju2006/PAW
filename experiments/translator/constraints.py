from itertools import product

from t5small import tokenizer, generate

actions = ["create", "update", "delete"]
targets = ["collection", "record", "interface"]

valid_outputs = [f"{action} {target}" for action, target in product(actions, targets)]
valid_outputs.append("unsupported")

valid_sequences = [
    tokenizer.encode(text, add_special_tokens=False) + [tokenizer.eos_token_id]
    for text in valid_outputs
]


def allowed_tokens(batch_id, input_ids):
    prefix = input_ids[1:].tolist()
    length = len(prefix)

    allowed = {
        sequence[length]
        for sequence in valid_sequences
        if len(sequence) > length and sequence[:length] == prefix
    }

    if not allowed:
        raise ValueError("Invalid generation prefix")

    return sorted(allowed)


while True:
    prompt = input("\nInstruction: ")

    if prompt == "exit":
        break

    print("Unconstrained:", generate(prompt))
    print("Constrained:", generate(prompt, prefix_allowed_tokens_fn=allowed_tokens))