#!/usr/bin/env python3
import argparse
from dreamina_wrapper import print_payload, run_dreamina


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dreamina-bin", required=True)
    args = parser.parse_args()
    print_payload(run_dreamina(args.dreamina_bin, ["user_credit"]))


if __name__ == "__main__":
    main()
