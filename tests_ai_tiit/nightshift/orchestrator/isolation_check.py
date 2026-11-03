import os
import sys
import json
from .stand import check_isolation, StandError
from .masking import mask_obj


def main():
    try:
        print(json.dumps(mask_obj(check_isolation(os.environ.get('NS_PROJECT'))), ensure_ascii=False))
        return 0
    except (StandError, OSError, ValueError) as exc:
        print(json.dumps(mask_obj({'error': str(exc)}), ensure_ascii=False))
        return 2


if __name__ == '__main__':
    sys.exit(main())
