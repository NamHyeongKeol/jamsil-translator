import XCTest
@testable import MingleIOS

final class WorkflowParserTests: XCTestCase {
    func testNormalizeTurnTextRemovesMarkersAndNoise() {
        let text = STTWorkflowParser.normalizeTurnText(" <fin> ... Hello there ")
        XCTAssertEqual(text, "Hello there")
    }

    func testParseTranscriptEvent() {
        let json = """
        {
          "type": "transcript",
          "data": {
            "is_final": true,
            "utterance": {
              "text": " <end> hello everyone",
              "language": "en-US"
            }
          }
        }
        """

        let event = STTWorkflowParser.parseServerEvent(jsonText: json)
        switch event {
        case let .transcript(payload):
            XCTAssertEqual(payload.text, "hello everyone")
            XCTAssertEqual(payload.language, "en-US")
            XCTAssertTrue(payload.isFinal)
        default:
            XCTFail("Expected transcript event")
        }
    }

    func testBuildFinalizedUtterancePayloadFiltersSourceLanguage() {
        let payload = STTWorkflowParser.buildFinalizedUtterancePayload(
            input: BuildFinalizedUtterancePayloadInput(
                rawText: " <end> hello everyone ",
                rawLanguage: "en-US",
                languages: ["en", "ko", "ja", "KO"],
                partialTranslations: [
                    "en": "self",
                    "ko": " 안녕하세요 ",
                    "ja": " こんにちは "
                ],
                utteranceSerial: 2,
                nowMs: 1_700_000_000_000,
                previousStateSourceLanguage: nil,
                previousStateSourceText: nil
            )
        )

        XCTAssertNotNil(payload)
        XCTAssertEqual(payload?.utterance.id, "u-1700000000000-2")
        XCTAssertEqual(payload?.utterance.originalText, "hello everyone")
        XCTAssertEqual(payload?.utterance.targetLanguages, ["ko", "ja"])
        XCTAssertEqual(payload?.utterance.translations, ["ko": "안녕하세요", "ja": "こんにちは"])
    }
}
