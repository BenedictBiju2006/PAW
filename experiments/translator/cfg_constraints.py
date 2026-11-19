from pathlib import Path
from transformers_cfg.grammar_utils import IncrementalGrammarConstraint
from transformers_cfg.generation.logits_process import GrammarConstrainedLogitsProcessor

from t5small import tokenizer, generate

from transformers_cfg.tokenization.byte_trie import ByteTrie
from transformers_cfg.tokenization.middle.TokenizerMiddleMapping import TokenizerMiddleMapping


class StatelessT5Mapping(TokenizerMiddleMapping):
    def map(self, token_id, verbose=False):
        token_id = int(token_id)

        if token_id in self.special:
            return b""

        token = self.tokenizer.convert_ids_to_tokens(token_id)
        return token.replace("▁", " ").encode("utf-8")


def build_token_trie(tokenizer, mapping):
    trie = ByteTrie()
    trie.vocab_size = len(tokenizer.get_vocab())

    for token_id in tokenizer.get_vocab().values():
        if token_id not in tokenizer.all_special_ids:
            token_bytes = mapping.map(token_id)

            if token_bytes:
                trie.insert(token_bytes, token_id)

    return trie

GRAMMAR = (Path(__file__).parent / "paw.ebnf").read_text(encoding="utf-8")

mapping = StatelessT5Mapping(tokenizer)
trie = build_token_trie(tokenizer, mapping)


def generate_constrained(prompt):
    grammar = IncrementalGrammarConstraint(GRAMMAR, "root", tokenizer, trie=trie, homomorphism=mapping)
    processor = GrammarConstrainedLogitsProcessor(grammar, valid_token_start_idx=1)

    return generate(prompt, logits_processor=[processor])



if __name__ == "__main__":
    while True:
        prompt = input("\nInstruction: ")

        if prompt == "exit":
            break

        print("Unconstrained:", generate(prompt))
        print("Constrained:", generate_constrained(prompt))