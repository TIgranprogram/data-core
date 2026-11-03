import os
import sys
from orchestrator.stand import regression, StandError, AppFailure
from orchestrator.masking import mask_text


def main():
    try:
        print(regression(os.environ.get('NS_PROJECT')))
    except AppFailure as exc:
        print(mask_text(str(exc)), file=sys.stderr)
        return 1
    except StandError as exc:
        print(mask_text(str(exc)), file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main())
