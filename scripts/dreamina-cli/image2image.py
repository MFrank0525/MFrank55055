#!/usr/bin/env python3
import argparse
from dreamina_wrapper import print_payload, run_dreamina


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dreamina-bin", required=True)
    parser.add_argument("--images", required=True)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--ratio", default="")
    parser.add_argument("--resolution-type", default="")
    parser.add_argument("--model-version", default="")
    parser.add_argument("--poll", default="0")
    args = parser.parse_args()

    command = [
        "image2image",
        "--images",
        args.images,
        "--prompt",
        args.prompt,
        "--poll",
        str(args.poll),
    ]
    if args.ratio:
        command.extend(["--ratio", args.ratio])
    if args.resolution_type:
        command.extend(["--resolution_type", args.resolution_type])
    if args.model_version:
        command.extend(["--model_version", args.model_version])

    print_payload(run_dreamina(args.dreamina_bin, command))


if __name__ == "__main__":
    main()
