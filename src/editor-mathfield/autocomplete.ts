import { LatexAtom } from '../core-atoms/latex';
import { suggest } from '../core-definitions/definitions-utils';
import type { ModelPrivate } from '../editor-model/model-private';
import { ParseMode } from '../public/core';
import type { MathfieldPrivate } from './mathfield-private';
import { ModeEditor } from './mode-editor';
import {
  getCommandSuggestionRange,
  getLatexGroup,
  getLatexGroupBody,
} from './mode-editor-latex';
import { requestUpdate } from './render';

export function updateAutocomplete(
  mathfield: MathfieldPrivate,
  options?: { atIndex?: number }
): void {
  const { model } = mathfield;
  // Remove any error indicator and any suggestions
  for (const atom of getLatexGroupBody(model)) {
    if (atom.isSuggestion) {
      atom.parent!.removeChild(atom);
    } else {
      atom.isError = false;
    }
  }

  if (!model.selectionIsCollapsed) {
    return;
  }

  // The current command is the sequence of atom around the insertion point
  // that ends on the left with a '\' and on the right with a non-command
  // character.
  const command: LatexAtom[] = [];
  let atom = model.at(model.position);
  while (atom && atom instanceof LatexAtom && /[a-zA-Z*]$/.test(atom.value)) {
    command.unshift(atom);
    atom = atom.leftSibling;
  }

  const leftSibling = atom?.leftSibling;
  if (
    atom &&
    atom instanceof LatexAtom &&
    atom.value === '\\' &&
    !(leftSibling instanceof LatexAtom && atom.value === '\\')
  ) {
    // We found the beginning of a command, include the atoms after the
    // insertion point
    command.unshift(atom);
    atom = model.at(model.position).rightSibling;
    while (atom && atom instanceof LatexAtom && /[a-zA-Z*]$/.test(atom.value)) {
      command.push(atom);
      atom = atom.rightSibling;
    }
  }

  const commandString = command.map((x) => x.value).join('');
  const suggestions = commandString ? suggest(mathfield, commandString) : [];

  if (suggestions.length === 0) {
    if (/^\\[a-zA-Z\*]+$/.test(commandString)) {
      // This looks like a command name, but not a known one
      command.forEach((x) => (x.isError = true));
    }

    return;
  }

  mathfield.suggestionIndex = options?.atIndex ?? 0;
  if (mathfield.suggestionIndex < 0) {
    mathfield.suggestionIndex = suggestions.length - 1;
  }

  const suggestion =
    suggestions[mathfield.suggestionIndex % suggestions.length];
  if (suggestion !== commandString) {
    const lastAtom = command[command.length - 1];
    lastAtom.parent!.addChildrenAfter(
      [...suggestion.slice(commandString.length - suggestion.length)].map(
        (x) => new LatexAtom(x, { isSuggestion: true })
      ),
      lastAtom
    );
    requestUpdate(mathfield);
  }
}

export function acceptCommandSuggestion(model: ModelPrivate): boolean {
  const [from, to] = getCommandSuggestionRange(model, {
    before: model.position,
  });
  if (from === undefined || to === undefined) return false;
  let result = false;
  model.getAtoms([from, to]).forEach((x: LatexAtom) => {
    if (x.isSuggestion) {
      x.isSuggestion = false;
      result = true;
    }
  });
  return result;
}

/**
 * When in Latex mode, insert the Latex being edited and leave latex mode
 *
 */
export function complete(
  mathfield: MathfieldPrivate,
  completion: 'reject' | 'accept' | 'accept-suggestion' = 'accept',
  options?: { mode?: ParseMode; selectItem?: boolean }
): boolean {
  const latexGroup = getLatexGroup(mathfield.model);
  if (!latexGroup) return false;

  if (completion === 'accept-suggestion') {
    const suggestions = getLatexGroupBody(mathfield.model).filter(
      (x) => x.isSuggestion
    );
    if (suggestions.length === 0) return false;
    for (const suggestion of suggestions) suggestion.isSuggestion = false;

    mathfield.model.position = mathfield.model.offsetOf(
      suggestions[suggestions.length - 1]
    );
    return true;
  }

  const body = getLatexGroupBody(mathfield.model).filter(
    (x) => !x.isSuggestion
  );

  const latex = body.map((x) => x.value).join('');

  const newPos = latexGroup.leftSibling;
  latexGroup.parent!.removeChild(latexGroup);
  mathfield.model.position = mathfield.model.offsetOf(newPos);
  mathfield.mode = options?.mode ?? 'math';

  if (completion === 'reject') return true;

  ModeEditor.insert('math', mathfield.model, latex, {
    macros: mathfield.options.macros,
    selectionMode: options?.selectItem ?? false ? 'item' : 'placeholder',
    format: 'latex',
  });

  mathfield.snapshot();
  mathfield.model.announce('replacement');
  return true;
}
