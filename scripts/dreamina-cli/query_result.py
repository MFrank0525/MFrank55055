#!/usr/bin/env python3
import argparse
from dreamina_wrapper import print_payload, run_dreamina


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dreamina-bin", required=True)
    parser.add_argument("--submit-id", required=True)
    parser.add_argument("--download-dir", default="")
    args = parser.parse_args()

    command = ["query_result", "--submit_id", args.submit_id]
    if args.download_dir:
        command.extend(["--download_dir", args.download_dir])

    print_payload(run_dreamina(args.dreamina_bin, command))


if __name__ == "__main__":
    main()
