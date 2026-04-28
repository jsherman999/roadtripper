import argparse

from storyguide.server import run_server


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="RoadTrip Storyguide server")
    parser.add_argument("--port", type=int, default=8001, help="Port to listen on (default: 8001)")
    args = parser.parse_args()
    run_server(host="0.0.0.0", port=args.port)
