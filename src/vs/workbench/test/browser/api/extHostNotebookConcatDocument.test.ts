/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestRPCProtocol } from 'vs/workbench/test/browser/api/testRPCProtocol';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { NullLogService } from 'vs/platform/log/common/log';
import { ExtHostNotebookConcatDocument } from 'vs/workbench/api/common/extHostNotebookConcatDocument';
import { ExtHostNotebookDocument, ExtHostNotebookController } from 'vs/workbench/api/common/extHostNotebook';
import { URI } from 'vs/base/common/uri';
import { CellKind, CellUri } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Position, Location } from 'vs/workbench/api/common/extHostTypes';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { nullExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { NotebookProvider } from 'vscode';
import { mock } from 'vs/workbench/test/common/workbenchTestServices';
import { MainContext, MainThreadCommandsShape, MainThreadNotebookShape } from 'vs/workbench/api/common/extHost.protocol';
import { DisposableStore } from 'vs/base/common/lifecycle';


suite('NotebookConcatDocument', function () {

	let rpcProtocol: TestRPCProtocol;
	let notebook: ExtHostNotebookDocument;
	let extHostDocumentsAndEditors: ExtHostDocumentsAndEditors;
	let extHostDocuments: ExtHostDocuments;
	let extHostNotebooks: ExtHostNotebookController;
	const notebookUri = URI.parse('test:///notebook.file');
	const disposables = new DisposableStore();

	setup(async function () {
		disposables.clear();

		rpcProtocol = new TestRPCProtocol();
		rpcProtocol.set(MainContext.MainThreadCommands, new class extends mock<MainThreadCommandsShape>() {
			$registerCommand() { }
		});
		rpcProtocol.set(MainContext.MainThreadNotebook, new class extends mock<MainThreadNotebookShape>() {
			async $registerNotebookProvider() { }
			async $unregisterNotebookProvider() { }
			async $createNotebookDocument() { }
		});
		extHostDocumentsAndEditors = new ExtHostDocumentsAndEditors(rpcProtocol, new NullLogService());
		extHostDocuments = new ExtHostDocuments(rpcProtocol, extHostDocumentsAndEditors);
		extHostNotebooks = new ExtHostNotebookController(rpcProtocol, new ExtHostCommands(rpcProtocol, new NullLogService()), extHostDocumentsAndEditors);
		let reg = extHostNotebooks.registerNotebookProvider(nullExtensionDescription, 'test', new class extends mock<NotebookProvider>() {
			async resolveNotebook() { }
		});
		await extHostNotebooks.$resolveNotebook('test', notebookUri);
		await extHostNotebooks.$updateActiveEditor('test', notebookUri);

		notebook = extHostNotebooks.activeNotebookDocument!;

		disposables.add(reg);
		disposables.add(notebook);
		disposables.add(extHostDocuments);
	});

	test('empty', function () {
		let doc = new ExtHostNotebookConcatDocument(notebook, extHostNotebooks, extHostDocuments);
		assert.equal(doc.getText(), '');
		assert.equal(doc.versionId, 0);

		// assert.equal(doc.locationAt(new Position(0, 0)), undefined);
		// assert.equal(doc.positionAt(SOME_FAKE_LOCATION?), undefined);
	});

	function assertLocation(doc: ExtHostNotebookConcatDocument, pos: Position, expected: Location, reverse = true) {
		const actual = doc.locationAt(pos);
		assert.equal(actual.uri.toString(), expected.uri.toString());
		assert.equal(actual.range.isEqual(expected.range), true);

		if (reverse) {
			// reverse - offset
			const offset = doc.offsetAt(pos);
			assert.equal(doc.positionAt(offset).isEqual(pos), true);

			// reverse - pos
			const actualPosition = doc.positionAt(actual);
			assert.equal(actualPosition.isEqual(pos), true);
		}
	}

	function assertLines(doc: ExtHostNotebookConcatDocument, ...lines: string[]) {
		let actual = doc.getText().split(/\r\n|\n|\r/);
		assert.deepStrictEqual(actual, lines);
	}

	test('location, position mapping', function () {

		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.versionId + 1,
			changes: [[0, 0, [{
				handle: 1,
				uri: CellUri.generate(notebook.uri, 1),
				source: ['Hello', 'World', 'Hello World!'],
				language: 'test',
				cellKind: CellKind.Code,
				outputs: [],
			}, {
				handle: 2,
				uri: CellUri.generate(notebook.uri, 2),
				source: ['Hallo', 'Welt', 'Hallo Welt!'],
				language: 'test',
				cellKind: CellKind.Code,
				outputs: [],
			}]]]
		});


		assert.equal(notebook.cells.length, 2);

		let doc = new ExtHostNotebookConcatDocument(notebook, extHostNotebooks, extHostDocuments);
		assertLines(doc, 'Hello', 'World', 'Hello World!', 'Hallo', 'Welt', 'Hallo Welt!');

		assertLocation(doc, new Position(0, 0), new Location(notebook.cells[0].uri, new Position(0, 0)));
		assertLocation(doc, new Position(4, 0), new Location(notebook.cells[1].uri, new Position(1, 0)));
		assertLocation(doc, new Position(4, 3), new Location(notebook.cells[1].uri, new Position(1, 3)));
		assertLocation(doc, new Position(5, 11), new Location(notebook.cells[1].uri, new Position(2, 11)));
		assertLocation(doc, new Position(5, 12), new Location(notebook.cells[1].uri, new Position(2, 11)), false); // don't check identity because position will be clamped
	});


	test('location, position mapping, cell changes', function () {

		let doc = new ExtHostNotebookConcatDocument(notebook, extHostNotebooks, extHostDocuments);

		// UPDATE 1
		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.versionId + 1,
			changes: [[0, 0, [{
				handle: 1,
				uri: CellUri.generate(notebook.uri, 1),
				source: ['Hello', 'World', 'Hello World!'],
				language: 'test',
				cellKind: CellKind.Code,
				outputs: [],
			}]]]
		});
		assert.equal(notebook.cells.length, 1);
		assert.equal(doc.versionId, 1);
		assertLines(doc, 'Hello', 'World', 'Hello World!');

		assertLocation(doc, new Position(0, 0), new Location(notebook.cells[0].uri, new Position(0, 0)));
		assertLocation(doc, new Position(2, 2), new Location(notebook.cells[0].uri, new Position(2, 2)));
		assertLocation(doc, new Position(4, 0), new Location(notebook.cells[0].uri, new Position(2, 12)), false); // clamped


		// UPDATE 2
		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.versionId + 1,
			changes: [[1, 0, [{
				handle: 2,
				uri: CellUri.generate(notebook.uri, 2),
				source: ['Hallo', 'Welt', 'Hallo Welt!'],
				language: 'test',
				cellKind: CellKind.Code,
				outputs: [],
			}]]]
		});

		assert.equal(notebook.cells.length, 2);
		assert.equal(doc.versionId, 2);
		assertLines(doc, 'Hello', 'World', 'Hello World!', 'Hallo', 'Welt', 'Hallo Welt!');
		assertLocation(doc, new Position(0, 0), new Location(notebook.cells[0].uri, new Position(0, 0)));
		assertLocation(doc, new Position(4, 0), new Location(notebook.cells[1].uri, new Position(1, 0)));
		assertLocation(doc, new Position(4, 3), new Location(notebook.cells[1].uri, new Position(1, 3)));
		assertLocation(doc, new Position(5, 11), new Location(notebook.cells[1].uri, new Position(2, 11)));
		assertLocation(doc, new Position(5, 12), new Location(notebook.cells[1].uri, new Position(2, 11)), false); // don't check identity because position will be clamped

		// UPDATE 3 (remove cell #2 again)
		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.versionId + 1,
			changes: [[1, 1, []]]
		});
		assert.equal(notebook.cells.length, 1);
		assert.equal(doc.versionId, 3);
		assertLines(doc, 'Hello', 'World', 'Hello World!');
		assertLocation(doc, new Position(0, 0), new Location(notebook.cells[0].uri, new Position(0, 0)));
		assertLocation(doc, new Position(2, 2), new Location(notebook.cells[0].uri, new Position(2, 2)));
		assertLocation(doc, new Position(4, 0), new Location(notebook.cells[0].uri, new Position(2, 12)), false); // clamped
	});

	test('location, position mapping, cell-document changes', function () {

		let doc = new ExtHostNotebookConcatDocument(notebook, extHostNotebooks, extHostDocuments);

		// UPDATE 1
		extHostNotebooks.$acceptModelChanged(notebookUri, {
			versionId: notebook.versionId + 1,
			changes: [[0, 0, [{
				handle: 1,
				uri: CellUri.generate(notebook.uri, 1),
				source: ['Hello', 'World', 'Hello World!'],
				language: 'test',
				cellKind: CellKind.Code,
				outputs: [],
			}, {
				handle: 2,
				uri: CellUri.generate(notebook.uri, 2),
				source: ['Hallo', 'Welt', 'Hallo Welt!'],
				language: 'test',
				cellKind: CellKind.Code,
				outputs: [],
			}]]]
		});
		assert.equal(notebook.cells.length, 2);
		assert.equal(doc.versionId, 1);

		assertLines(doc, 'Hello', 'World', 'Hello World!', 'Hallo', 'Welt', 'Hallo Welt!');
		assertLocation(doc, new Position(0, 0), new Location(notebook.cells[0].uri, new Position(0, 0)));
		assertLocation(doc, new Position(2, 2), new Location(notebook.cells[0].uri, new Position(2, 2)));
		assertLocation(doc, new Position(2, 12), new Location(notebook.cells[0].uri, new Position(2, 12)));
		assertLocation(doc, new Position(4, 0), new Location(notebook.cells[1].uri, new Position(1, 0)));
		assertLocation(doc, new Position(4, 3), new Location(notebook.cells[1].uri, new Position(1, 3)));

		// offset math
		let cell1End = doc.offsetAt(new Position(2, 12));
		assert.equal(doc.positionAt(cell1End).isEqual(new Position(2, 12)), true);

		extHostDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({
			addedDocuments: [{
				uri: notebook.cells[0].uri,
				versionId: 1,
				lines: ['Hello', 'World', 'Hello World!'],
				EOL: '\n',
				modeId: '',
				isDirty: false
			}]
		});

		extHostDocuments.$acceptModelChanged(notebook.cells[0].uri, {
			versionId: 0,
			eol: '\n',
			changes: [{
				range: { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 6 },
				rangeLength: 6,
				rangeOffset: 12,
				text: 'Hi'
			}]
		}, false);
		assertLines(doc, 'Hello', 'World', 'Hi World!', 'Hallo', 'Welt', 'Hallo Welt!');
		assertLocation(doc, new Position(2, 12), new Location(notebook.cells[0].uri, new Position(2, 9)), false);

		assert.equal(doc.positionAt(cell1End).isEqual(new Position(3, 2)), true);

	});
});
