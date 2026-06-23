import json
import os
import sys


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Missing audio path."}))
        return 1

    audio_path = sys.argv[1]
    model_name = os.environ.get("WHISPER_MODEL", "tiny")

    try:
        import whisper

        model = whisper.load_model(model_name)
        result = model.transcribe(audio_path, fp16=False)
        transcript = (result.get("text") or "").strip()

        print(json.dumps({
            "success": True,
            "provider": "local-whisper",
            "model": model_name,
            "transcript": transcript,
        }))
        return 0
    except Exception as error:
        print(json.dumps({
            "success": False,
            "error": str(error),
        }))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
