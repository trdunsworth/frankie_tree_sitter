package tree_sitter_frankie_test

import (
	"testing"

	tree_sitter "github.com/tree-sitter/go-tree-sitter"
	tree_sitter_frankie "github.com/trdunsworth/frankie_tree_sitter/bindings/go"
)

func TestCanLoadGrammar(t *testing.T) {
	language := tree_sitter.NewLanguage(tree_sitter_frankie.Language())
	if language == nil {
		t.Errorf("Error loading Frankie grammar")
	}
}
