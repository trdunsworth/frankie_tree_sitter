import XCTest
import SwiftTreeSitter
import TreeSitterFrankie

final class TreeSitterFrankieTests: XCTestCase {
    func testCanLoadGrammar() throws {
        let parser = Parser()
        let language = Language(language: tree_sitter_frankie())
        XCTAssertNoThrow(try parser.setLanguage(language),
                         "Error loading Frankie grammar")
    }
}
