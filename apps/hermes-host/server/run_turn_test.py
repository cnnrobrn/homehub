import json
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_turn


class RunTurnContextTest(unittest.TestCase):
    def tearDown(self) -> None:
        os.environ.pop("HOMEHUB_CONVERSATION_HISTORY", None)

    def test_load_conversation_history_filters_and_orders_turns(self) -> None:
        os.environ["HOMEHUB_CONVERSATION_HISTORY"] = json.dumps(
            [
                {"role": "member", "body_md": "build me a budget", "created_at": "t1"},
                {},
                {"role": "assistant", "body_md": "What is your take-home pay?", "created_at": "t2"},
                {"role": "assistant", "body_md": "   ", "created_at": "t3"},
            ]
        )

        history = run_turn.load_conversation_history()

        self.assertEqual(
            history,
            [
                {"role": "member", "body_md": "build me a budget", "created_at": "t1"},
                {
                    "role": "assistant",
                    "body_md": "What is your take-home pay?",
                    "created_at": "t2",
                },
            ],
        )

    def test_build_contextual_message_wraps_follow_up_with_same_thread_context(self) -> None:
        message = "10k, 8k"
        history = [
            {"role": "member", "body_md": "build me a budget", "created_at": "t1"},
            {
                "role": "assistant",
                "body_md": "What is your monthly take-home pay and monthly bills?",
                "created_at": "t2",
            },
        ]

        contextual = run_turn.build_contextual_message(message, history)

        self.assertIn("[HomeHub same-thread context]", contextual)
        self.assertIn("member: build me a budget", contextual)
        self.assertIn("alfred: What is your monthly take-home pay and monthly bills?", contextual)
        self.assertTrue(contextual.endswith("[Current member message]\n10k, 8k"))

    def test_default_toolsets_include_terminal_for_homehub_skills(self) -> None:
        self.assertEqual(run_turn.DEFAULT_TOOLSETS, "skills,terminal")


if __name__ == "__main__":
    unittest.main()
