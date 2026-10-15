from __future__ import annotations

import io
import json
import subprocess
import sys
import tarfile
import tempfile
import unittest
import urllib.error
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import release_github
import release_npm
import release_service
import release_version


class VersionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        fixtures = {
            "VERSION": "0.2.2\n",
            "code/client/package.json": json.dumps(
                {"name": release_npm.PACKAGE, "version": "0.2.2"}
            ),
            "code/client/package-lock.json": json.dumps(
                {
                    "version": "0.2.2",
                    "packages": {
                        "": {"version": "0.2.2"},
                        "node_modules/vite": {
                            "version": "5.4.11",
                            "integrity": "untouched",
                        },
                    },
                }
            ),
            "code/server/pyproject.toml": '[project]\nversion = "0.2.2"\n',
            "code/server/src/phylo_lens_server/utils/versions.py": 'API_VERSION = "1"\nSERVICE_VERSION_FALLBACK = "0.2.2"\n',
            "code/server/Dockerfile": "FROM example\nARG VERSION=0.2.2\n",
            "code/server/compose.yaml": "services:\n  service:\n    image: ghcr.io/phyloviz/phylo-lens-service:0.2.2\n",
        }
        for name, content in fixtures.items():
            target = self.root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content)

    def test_failed_release_tags_are_reserved_and_ordered_numerically(self):
        self.assertEqual(
            release_version.next_version("0.2.2", ["v0.2.3"], "patch"), "0.2.4"
        )
        self.assertEqual(
            release_version.next_version(
                "0.2.2", ["v0.2.9", "v0.2.10", "v0.3.0-rc.1", "other"], "patch"
            ),
            "0.2.11",
        )
        self.assertEqual(release_version.next_version("0.2.2", [], "minor"), "0.3.0")
        self.assertEqual(release_version.next_version("0.2.2", [], "major"), "1.0.0")

    def test_preparation_updates_all_declarations_without_changing_dependencies_or_api(
        self,
    ):
        original = json.loads((self.root / "code/client/package-lock.json").read_text())
        release_version.prepare(self.root, "0.2.4")
        self.assertEqual(release_version.check(self.root, "v0.2.4"), "0.2.4")
        updated = json.loads((self.root / "code/client/package-lock.json").read_text())
        self.assertEqual(
            original["packages"]["node_modules/vite"],
            updated["packages"]["node_modules/vite"],
        )
        self.assertIn(
            'API_VERSION = "1"',
            (
                self.root / "code/server/src/phylo_lens_server/utils/versions.py"
            ).read_text(),
        )

    def test_mismatch_fails_before_preparation_writes_any_files(self):
        path = self.root / "code/server/compose.yaml"
        path.write_text(path.read_text().replace("0.2.2", "0.1.0"))
        before = {p: p.read_bytes() for p in self.root.rglob("*") if p.is_file()}
        with self.assertRaisesRegex(ValueError, "Compose image"):
            release_version.prepare(self.root, "0.2.4")
        self.assertEqual(before, {p: p.read_bytes() for p in before})

    def test_tag_mismatch_and_invalid_versions_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "does not match"):
            release_version.check(self.root, "v0.2.3")
        for tag in [
            "0.2.2",
            "v01.2.2",
            "v1.2",
            "v1.2.3-rc.1",
            "v1.2.3\n",
            "v1.2.3; echo unsafe",
        ]:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                release_version.tag_version(tag)
        with self.assertRaises(ValueError):
            release_version.prepare(self.root, "0.2.1")


class NpmTests(unittest.TestCase):
    def test_only_404_means_package_is_absent(self):
        for status in [401, 403, 429, 500, 503]:
            error = urllib.error.HTTPError("url", status, "error", {}, None)
            with (
                self.subTest(status=status),
                patch.object(release_npm.urllib.request, "urlopen", side_effect=error),
                self.assertRaises(urllib.error.HTTPError),
            ):
                release_npm.get_json("https://example.invalid")
        error = urllib.error.HTTPError("url", 404, "not found", {}, None)
        with patch.object(release_npm.urllib.request, "urlopen", side_effect=error):
            self.assertIsNone(release_npm.get_json("https://example.invalid"))

    def test_retry_requires_identical_tarball_integrity(self):
        with patch.object(
            release_npm,
            "get_json",
            return_value={"dist": {"integrity": "sha512-original"}},
        ):
            self.assertTrue(release_npm.verify("0.2.4", "sha512-original"))
            with self.assertRaisesRegex(ValueError, "different bytes"):
                release_npm.verify("0.2.4", "sha512-changed")

    def test_old_recovery_cannot_move_latest_backwards(self):
        with (
            patch.object(release_npm, "get_json", return_value={"version": "0.3.0"}),
            self.assertRaisesRegex(ValueError, "backwards"),
        ):
            release_npm.require_latest("0.2.4")

    def test_tarball_identity_is_checked_without_extracting_files(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "package.tgz"
            data = json.dumps(
                {"name": release_npm.PACKAGE, "version": "0.2.4"}
            ).encode()
            with tarfile.open(path, "w:gz") as archive:
                member = tarfile.TarInfo("package/package.json")
                member.size = len(data)
                archive.addfile(member, io.BytesIO(data))
            self.assertTrue(
                release_npm.package_info(path, "0.2.4").startswith("sha512-")
            )
            with self.assertRaisesRegex(ValueError, "name/version"):
                release_npm.package_info(path, "0.2.5")

    def test_existing_matching_package_never_calls_publish(self):
        with (
            patch.object(
                sys, "argv", ["release_npm.py", "publish", "0.2.4", "package.tgz"]
            ),
            patch.object(release_npm, "package_info", return_value="sha512-expected"),
            patch.object(release_npm, "verify", return_value=True),
            patch.object(release_npm.subprocess, "run") as publish,
        ):
            release_npm.main()
            publish.assert_not_called()


class ServiceTests(unittest.TestCase):
    def test_auth_and_network_errors_are_never_treated_as_missing_images(self):
        ref = "ghcr.io/phyloviz/phylo-lens-service:0.2.4"
        for error in [
            "401 unauthorized",
            "429 too many requests",
            f"ERROR: {ref}: failed to authorize: 404 Not Found",
            "network unavailable",
        ]:
            result = subprocess.CompletedProcess([], 1, "", error)
            with (
                self.subTest(error=error),
                patch.object(release_service.subprocess, "run", return_value=result),
                self.assertRaises(RuntimeError),
            ):
                release_service.manifest(ref)
        result = subprocess.CompletedProcess([], 1, "", f"ERROR: {ref}: not found")
        with patch.object(release_service.subprocess, "run", return_value=result):
            self.assertIsNone(release_service.manifest(ref))

    def test_both_platforms_and_exact_configs_are_required(self):
        expected = {"amd64": "sha256:amd64", "arm64": "sha256:arm64"}
        index = {
            "manifests": [
                {
                    "platform": {"os": "linux", "architecture": arch},
                    "digest": f"sha256:{arch}",
                }
                for arch in expected
            ]
        }
        with patch.object(
            release_service,
            "manifest",
            side_effect=lambda ref: {"config": {"digest": ref.split("@", 1)[1]}},
        ):
            release_service.verify_index(index, expected)
            with self.assertRaisesRegex(ValueError, "does not match"):
                release_service.verify_index(
                    {"manifests": index["manifests"][:1]}, expected
                )
            with self.assertRaisesRegex(ValueError, "does not match"):
                release_service.verify_index(
                    index, {"amd64": "sha256:changed", "arm64": "sha256:arm64"}
                )
            with self.assertRaisesRegex(ValueError, "duplicate"):
                release_service.verify_index(
                    {"manifests": [index["manifests"][0]] * 2}, expected
                )

    def test_existing_matching_image_never_loads_or_pushes(self):
        with tempfile.TemporaryDirectory() as directory:
            artifacts = Path(directory)
            for arch in release_service.ARCHITECTURES:
                target = artifacts / f"service-{arch}"
                target.mkdir()
                (target / "image.json").write_text(
                    json.dumps(
                        {
                            "sha": "commit",
                            "version": "0.2.4",
                            "architecture": arch,
                            "config": f"sha256:{arch}",
                        }
                    )
                )
            with (
                patch.object(
                    release_service, "manifest", return_value={"existing": True}
                ),
                patch.object(release_service, "verify_index") as verify,
                patch.object(release_service, "run") as docker,
            ):
                release_service.publish("0.2.4", "commit", artifacts)
                verify.assert_called_once()
                docker.assert_not_called()
            with self.assertRaisesRegex(ValueError, "does not belong"):
                release_service.publish("0.2.4", "different-commit", artifacts)

    def test_first_publication_pushes_saved_images_and_assembles_by_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            artifacts = Path(directory)
            registry = {}
            pushes = []
            for arch in release_service.ARCHITECTURES:
                target = artifacts / f"service-{arch}"
                target.mkdir()
                (target / "image.json").write_text(
                    json.dumps(
                        {
                            "sha": "commit",
                            "version": "0.2.4",
                            "architecture": arch,
                            "config": f"sha256:{arch}",
                        }
                    )
                )

            def docker(*args):
                if args[:3] == ("docker", "image", "inspect"):
                    arch = args[-1].split("ci-")[1]
                    return json.dumps(
                        [
                            {
                                "Id": f"sha256:{arch}",
                                "Architecture": arch,
                                "Os": "linux",
                                "Config": {
                                    "Labels": {
                                        "org.opencontainers.image.revision": "commit",
                                        "org.opencontainers.image.version": "0.2.4",
                                    }
                                },
                            }
                        ]
                    )
                if args[:4] == ("docker", "buildx", "imagetools", "inspect"):
                    return "sha256:manifest-" + args[4].rsplit("-", 1)[1]
                return ""

            def mutation(args, **kwargs):
                if args[:2] == ["docker", "push"]:
                    pushes.append(args[-1])
                    arch = args[-1].rsplit("-", 1)[1]
                    registry[args[-1]] = {"config": {"digest": f"sha256:{arch}"}}
                elif args[:4] == ["docker", "buildx", "imagetools", "create"]:
                    self.assertTrue(all("@sha256:" in ref for ref in args[-2:]))
                    index = {
                        "manifests": [
                            {
                                "platform": {"os": "linux", "architecture": arch},
                                "digest": f"sha256:manifest-{arch}",
                            }
                            for arch in release_service.ARCHITECTURES
                        ]
                    }
                    registry[f"{release_service.IMAGE}:0.2.4"] = index
                    for arch in release_service.ARCHITECTURES:
                        registry[f"{release_service.IMAGE}@sha256:manifest-{arch}"] = {
                            "config": {"digest": f"sha256:{arch}"}
                        }
                else:
                    self.fail(f"Unexpected publication command: {args}")

            with (
                patch.object(release_service, "manifest", side_effect=registry.get),
                patch.object(release_service, "run", side_effect=docker),
                patch.object(release_service.subprocess, "run", side_effect=mutation),
            ):
                release_service.publish("0.2.4", "commit", artifacts)
                self.assertEqual(len(pushes), 2)
                release_service.publish("0.2.4", "commit", artifacts)
                self.assertEqual(len(pushes), 2)


class AnnouncementTests(unittest.TestCase):
    def test_existing_completed_release_is_not_recreated(self):
        with patch.object(
            release_github,
            "request",
            return_value={
                "draft": False,
                "prerelease": False,
                "html_url": "https://example.invalid",
            },
        ) as request:
            release_github.main("v0.2.4")
            request.assert_called_once_with("releases/tags/v0.2.4")

    def test_existing_draft_is_not_announced_implicitly(self):
        with (
            patch.object(release_github, "request", return_value={"draft": True}),
            self.assertRaisesRegex(ValueError, "draft/prerelease"),
        ):
            release_github.main("v0.2.4")


if __name__ == "__main__":
    unittest.main()
