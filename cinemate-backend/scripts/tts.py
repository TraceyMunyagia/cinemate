import json
import os
import subprocess
import sys


def main():
    if len(sys.argv) < 3:
        print(json.dumps({"success": False, "error": "Missing text or output path."}))
        return 1

    text = sys.argv[1]
    output_path = sys.argv[2]
    raw_output_path = f"{output_path}.aiff"

    try:
        import pyttsx3

        engine = pyttsx3.init()
        engine.setProperty("rate", 175)
        engine.save_to_file(text, raw_output_path)
        engine.runAndWait()
        engine.stop()

        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-loglevel",
                "error",
                "-i",
                raw_output_path,
                output_path,
            ],
            check=True,
        )

        print(json.dumps({
            "success": True,
            "provider": "pyttsx3",
            "outputPath": output_path,
        }))
        return 0
    except Exception as error:
        print(json.dumps({
            "success": False,
            "error": str(error),
        }))
        return 1
    finally:
        if os.path.exists(raw_output_path):
            os.remove(raw_output_path)


if __name__ == "__main__":
    raise SystemExit(main())
