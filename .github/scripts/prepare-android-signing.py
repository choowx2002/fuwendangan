"""Create the signing files consumed by the committed Android Gradle project."""

import base64
import os
from pathlib import Path


def escape_property(value: str) -> str:
    # Java Properties uses Latin-1; escape UTF-16 units, including special characters.
    encoded = value.encode('utf-16-be')
    return ''.join(
        f'\\u{int.from_bytes(encoded[index:index + 2], "big"):04x}'
        for index in range(0, len(encoded), 2)
    )


def main() -> None:
    required = ('ANDROID_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS')
    missing = [name for name in required if not os.environ.get(name)]
    if missing:
        raise SystemExit(f'::error::Configure GitHub Actions secrets: {", ".join(missing)}')

    keystore = Path(os.environ['RUNNER_TEMP']) / 'release.keystore'
    properties = Path('src-tauri/gen/android/keystore.properties')
    content = base64.b64decode(''.join(os.environ['ANDROID_KEYSTORE_BASE64'].split()), validate=True)
    if not content:
        raise SystemExit('::error::ANDROID_KEYSTORE_BASE64 decoded to an empty keystore')
    keystore.write_bytes(content)
    keystore.chmod(0o600)

    values = {
        'storeFile': str(keystore),
        'password': os.environ['ANDROID_KEYSTORE_PASSWORD'],
        'keyAlias': os.environ['ANDROID_KEY_ALIAS'],
    }
    properties.write_text(
        ''.join(f'{key}={escape_property(value)}\n' for key, value in values.items()),
        encoding='ascii',
    )
    properties.chmod(0o600)


if __name__ == '__main__':
    main()
