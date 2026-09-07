"""Credential safety checks; mock Keychain and HTTP, never load real keys."""
import contextlib
import getpass
import importlib.util
import io
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch
import warnings


PATH = Path(__file__).resolve().parents[1] / "scripts" / "deepseek-keychain.py"
# Synthetic format-only value, never a provider credential.
FAKE_KEY = "pdl_" + "sdbx_apikey_" + "a" * 26 + "_" + "b" * 22 + "_ccc"


def load_helper(provider="paddle-sandbox"):
    spec = importlib.util.spec_from_file_location("keychain_helper", PATH)
    module = importlib.util.module_from_spec(spec)
    with patch("sys.argv", [str(PATH), "--provider", provider]):
        spec.loader.exec_module(module)
    return module


class KeychainHelperTests(unittest.TestCase):
    def test_sandbox_rejects_live_client_and_malformed_keys(self):
        helper = load_helper()
        self.assertEqual(helper.validate_secret(FAKE_KEY), FAKE_KEY)
        for value in [FAKE_KEY.replace("sdbx", "live"), "test_example", "", FAKE_KEY + "\n"]:
            with self.assertRaises(RuntimeError):
                helper.validate_secret(value)

    def test_save_never_falls_back_to_echoed_input(self):
        helper = load_helper()

        def unsafe_input(*args):
            warnings.warn("Echo unavailable", getpass.GetPassWarning)
            return FAKE_KEY

        with patch("sys.argv", [str(PATH), "save"]), patch.object(helper.getpass, "getpass", side_effect=unsafe_input), patch.object(helper, "keychain") as storage:
            with self.assertRaises(getpass.GetPassWarning):
                helper.main()
            storage.assert_not_called()

    def test_save_stores_without_printing_value(self):
        helper = load_helper()
        output = io.StringIO()
        with patch("sys.argv", [str(PATH), "save"]), patch.object(helper.getpass, "getpass", return_value=FAKE_KEY), patch.object(helper, "keychain") as storage, contextlib.redirect_stdout(output):
            self.assertEqual(helper.main(), 0)
        storage.assert_called_once_with(FAKE_KEY)
        self.assertNotIn(FAKE_KEY, output.getvalue())

    def test_check_is_read_only_and_does_not_echo_catalog(self):
        helper = load_helper()
        output = io.StringIO()
        opener = Mock()
        response = io.StringIO(json.dumps({"data": [{"name": "PRIVATE_CATALOG_SENTINEL"}]}))
        opener.open.return_value.__enter__ = Mock(return_value=response)
        opener.open.return_value.__exit__ = Mock(return_value=False)
        with patch("sys.argv", [str(PATH), "check"]), patch.object(helper, "keychain", return_value=FAKE_KEY), patch.object(helper.urllib.request, "build_opener", return_value=opener), contextlib.redirect_stdout(output):
            helper.main()
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.full_url, "https://sandbox-api.paddle.com/products?per_page=1")
        self.assertEqual(json.loads(output.getvalue()), {"authenticated": True, "environment": "sandbox", "product_read": True})

    def test_child_gets_only_sandbox_environment_and_no_secret_argument(self):
        helper = load_helper()
        with patch("sys.argv", [str(PATH), "run", "node", "setup.mjs"]), patch.dict(helper.os.environ, {"PADDLE_ENVIRONMENT": "production"}, clear=True), patch.object(helper, "keychain", return_value=FAKE_KEY), patch.object(helper.subprocess, "run", return_value=Mock(returncode=0)) as run:
            self.assertEqual(helper.main(), 0)
        self.assertEqual(run.call_args.args[0], ["node", "setup.mjs"])
        self.assertEqual(run.call_args.kwargs["env"], {"PADDLE_API_KEY": FAKE_KEY, "PADDLE_ENVIRONMENT": "sandbox"})

    def test_existing_provider_keychain_items_are_unchanged(self):
        for provider, account in [("deepseek", b"director"), ("fal", b"video"), ("paddle-sandbox", b"api")]:
            helper = load_helper(provider)
            self.assertEqual(helper.SERVICE, ("afterlight." + provider).encode())
            self.assertEqual(helper.ACCOUNT, account)

    def test_fal_admin_uses_a_separate_keychain_item_and_environment(self):
        helper = load_helper("fal-admin")
        self.assertEqual(helper.SERVICE, b"afterlight.fal-admin")
        self.assertEqual(helper.ACCOUNT, b"billing")
        with patch("sys.argv", [str(PATH), "run", "node", "provision.mjs", "FAL_ADMIN_KEY"]), patch.dict(helper.os.environ, {"FAL_KEY": "existing-video-key"}, clear=True), patch.object(helper, "keychain", return_value="synthetic-admin-key"), patch.object(helper.subprocess, "run", return_value=Mock(returncode=0)) as run:
            self.assertEqual(helper.main(), 0)
        self.assertEqual(run.call_args.kwargs["env"], {"FAL_KEY": "existing-video-key", "FAL_ADMIN_KEY": "synthetic-admin-key"})
        self.assertNotIn("synthetic-admin-key", run.call_args.args[0])

    def test_fal_admin_check_only_reads_billing_and_hides_errors(self):
        helper = load_helper("fal-admin")
        opener = Mock()
        opener.open.side_effect = helper.urllib.error.HTTPError(
            "https://api.fal.ai/v1/account/billing?expand=credits", 403,
            "synthetic-private-error", {}, io.BytesIO(b"synthetic-admin-key")
        )
        output = io.StringIO()
        with patch("sys.argv", [str(PATH), "check"]), patch.object(helper, "keychain", return_value="synthetic-admin-key"), patch.object(helper.urllib.request, "build_opener", return_value=opener), contextlib.redirect_stdout(output):
            self.assertEqual(helper.main(), 1)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), "GET")
        self.assertEqual(request.full_url, "https://api.fal.ai/v1/account/billing?expand=credits")
        self.assertEqual(request.get_header("Authorization"), "Key synthetic-admin-key")
        self.assertEqual(json.loads(output.getvalue()), {"check_failed": True, "provider": "fal-admin", "http_status": 403})
        opener.open.side_effect.close()


if __name__ == "__main__":
    unittest.main()
