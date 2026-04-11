#!/usr/bin/env python3
"""
Encrypted secrets vault for ClaudeClaw agents.
Les credentials ne sont jamais accessibles en clair sur disque.
Chiffrement Fernet (AES-128-CBC + HMAC-SHA256).

Usage:
    from vault import vault
    token = vault.get("TELEGRAM_BOT_TOKEN")
    vault.set("NEW_KEY", "value")
"""

import json
import os
import sys
from pathlib import Path

try:
    from cryptography.fernet import Fernet, InvalidToken
except ImportError:
    print("ERROR: pip3 install cryptography", file=sys.stderr)
    sys.exit(1)

VAULT_FILE = Path.home() / ".claudeclaw" / "vault" / "secrets.enc"
KEY_FILE = Path.home() / ".claudeclaw" / "vault" / ".vault_key"


def _get_key() -> bytes:
    """Charge ou génère la clé maître du vault."""
    # Priorité 1 : variable d'environnement
    env_key = os.environ.get("CLAUDECLAW_VAULT_KEY")
    if env_key:
        return env_key.encode()

    # Priorité 2 : fichier clé (chmod 600)
    if KEY_FILE.exists():
        key = KEY_FILE.read_bytes().strip()
        if key:
            return key

    # Priorité 3 : générer une nouvelle clé
    key = Fernet.generate_key()
    KEY_FILE.parent.mkdir(parents=True, exist_ok=True)
    KEY_FILE.write_bytes(key)
    KEY_FILE.chmod(0o600)
    print(f"✅ Nouvelle clé vault générée : {KEY_FILE}", file=sys.stderr)
    return key


def _load() -> dict:
    """Charge et déchiffre le vault."""
    if not VAULT_FILE.exists():
        return {}
    try:
        f = Fernet(_get_key())
        raw = VAULT_FILE.read_bytes()
        return json.loads(f.decrypt(raw))
    except InvalidToken:
        print("❌ VAULT: clé invalide ou fichier corrompu", file=sys.stderr)
        return {}
    except Exception as e:
        print(f"❌ VAULT: erreur lecture — {e}", file=sys.stderr)
        return {}


def _save(data: dict):
    """Chiffre et sauvegarde le vault."""
    VAULT_FILE.parent.mkdir(parents=True, exist_ok=True)
    f = Fernet(_get_key())
    encrypted = f.encrypt(json.dumps(data, ensure_ascii=False).encode())
    VAULT_FILE.write_bytes(encrypted)
    VAULT_FILE.chmod(0o600)


class Vault:
    def __init__(self):
        self._data = None

    def _ensure_loaded(self):
        if self._data is None:
            self._data = _load()

    def get(self, key: str, default=None):
        """Récupère un secret. Fallback sur .env si pas dans le vault."""
        self._ensure_loaded()
        value = self._data.get(key)
        if value is not None:
            return value
        # Fallback .env
        return os.environ.get(key, default)

    def set(self, key: str, value: str):
        """Ajoute ou met à jour un secret dans le vault."""
        self._ensure_loaded()
        self._data[key] = value
        _save(self._data)

    def delete(self, key: str):
        """Supprime un secret du vault."""
        self._ensure_loaded()
        if key in self._data:
            del self._data[key]
            _save(self._data)

    def list_keys(self) -> list:
        """Liste les clés présentes dans le vault (sans les valeurs)."""
        self._ensure_loaded()
        return list(self._data.keys())

    def import_from_env_file(self, env_path: str, overwrite: bool = False):
        """Importe les secrets depuis un fichier .env vers le vault."""
        self._ensure_loaded()
        imported = []
        with open(env_path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, _, value = line.partition("=")
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                if key and value and (overwrite or key not in self._data):
                    self._data[key] = value
                    imported.append(key)
        if imported:
            _save(self._data)
        return imported


# Instance globale
vault = Vault()
