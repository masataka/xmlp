// Copyright 2020 Masataka Kurihara. All rights reserved. MIT license.

import {
    assert,
    assertEquals,
    assertThrows,
} from './dev_deps.ts';

import {
    ElementInfo,
    XMLParseContext,
    XMLParseEvent,
    XMLParseError,
} from "./context.ts";

import {
    ParserBase,
    SAXParser,
    PullParser,
    PullResult,
} from './parser.ts';

Deno.test('ParserBase chunk & hasNext & readNext & position', () => {
    // protected -> public visiblity
    class TestParser extends ParserBase {
        set chunk(chunk: string) {
            super.chunk = chunk;
        }

        readNext(): string {
            return super.readNext();
        }

        hasNext(): boolean {
            return super.hasNext();
        }
    }
    const parser = new TestParser();
    parser.chunk = 'a\nb';
    assertEquals(parser.readNext(), 'a');
    assertEquals(parser.position, { line: 1, column: 1 });
    assertEquals(parser.hasNext(), true);
    assertEquals(parser.readNext(), '\n');
    assertEquals(parser.position, { line: 2, column: 0 });
    assertEquals(parser.readNext(), 'b');
    assertEquals(parser.position, { line: 2, column: 1 });
    assertEquals(parser.hasNext(), false);
});

Deno.test('SAXParser on & parse(Deno.Reader)', async () => {
    const parser = new SAXParser();
    let assertionCount = 0;
    let elementCount = 0;
    parser.on('start_prefix_mapping', (ns, uri) => {
        assertionCount += 1;
        if (ns === 'atom') {
            assertEquals(uri, 'http://www.w3.org/2005/Atom');
        } else if (ns === 'm') {
            assertEquals(uri, 'https://xmlp.test/m');
        } else {
            assert(false);
        }
    }).on('start_element', (element) => {
        elementCount += 1;
        if (element.qName === 'guid') {
            assertionCount += 1;
            assertEquals(element.attributes[0].qName, 'isPermaLink');
            assertEquals(element.attributes[0].value, 'false');
        }
    });
    const file = await Deno.open('parser_test.xml');
    await parser.parse(file.readable);
    assertEquals(assertionCount, 3);
    assertEquals(elementCount, 18);
});

Deno.test('SAXParser parse(Uint8Array)', () => {
    const parser = new SAXParser();
    let flag = false;
    parser.on('text', (text) => {
        flag = true;
        assertEquals(text, 'world');
    });
    parser.parse(new TextEncoder().encode('<hello>world</hello>'));
    assertEquals(flag, true);
});

Deno.test('SAXParser parse(string)', () => {
    const parser = new SAXParser();
    let flag = false;
    parser.on('start_element', (element) => {
        flag = true;
        assertEquals(element.qName, 'hello');
    });
    parser.parse('<hello>world</hello>');
    assertEquals(flag, true);
});

Deno.test('marshallEvent', () => {
    class TestParser extends PullParser {
        marshallEvent(event: XMLParseEvent): PullResult {
            return super.marshallEvent(event);
        }
    }
    const parser = new TestParser();
    const cx = new XMLParseContext();
    cx.newElement('a');
    const DUMMY = new ElementInfo(cx.peekElement()!);
    assertEquals(parser.marshallEvent(['start_document']), { name: 'start_document' });
    assertEquals(parser.marshallEvent(['processing_instruction', 'a']), { name: 'processing_instruction', procInst: 'a' });
    assertEquals(parser.marshallEvent(['sgml_declaration', 'a']), { name: 'sgml_declaration', sgmlDecl: 'a' });
    assertEquals(parser.marshallEvent(['text', 'a', DUMMY, true]), { name: 'text', text: 'a', element: DUMMY, cdata: true });
    assertEquals(parser.marshallEvent(['doctype', 'a']), { name: 'doctype', doctype: 'a' });
    assertEquals(parser.marshallEvent(['start_prefix_mapping', 'a', 'b']), { name: 'start_prefix_mapping', ns: 'a', uri: 'b' });
    assertEquals(parser.marshallEvent(['start_element', DUMMY]), { name: 'start_element', element: DUMMY });
    assertEquals(parser.marshallEvent(['comment', 'a']), { name: 'comment', comment: 'a' });
    assertEquals(parser.marshallEvent(['end_element', DUMMY]), { name: 'end_element', element: DUMMY });
    assertEquals(parser.marshallEvent(['end_prefix_mapping', 'a', 'b']), { name: 'end_prefix_mapping', ns: 'a', uri: 'b' });
    assertEquals(parser.marshallEvent(['end_document']), { name: 'end_document' });
});

Deno.test('PullParser', async () => {
    const parser = new PullParser();
    const file = await Deno.readFile('parser_test.xml');
    const events = parser.parse(file);
    assertEquals(events.next().value, { name: 'processing_instruction', procInst: 'xml version="1.0" encoding="utf-8"' });
    assertEquals(events.next().value, { name: 'start_document' });
    assertEquals(events.next().value, { name: 'start_prefix_mapping', ns: 'atom', uri: 'http://www.w3.org/2005/Atom' });
    assertEquals(events.next().value, { name: 'start_prefix_mapping', ns: 'm', uri: 'https://xmlp.test/m' });
    assertEquals((events.next().value as PullResult).element!.qName, 'rss');
    assertEquals((events.next().value as PullResult).element!.qName, 'channel');
    assertEquals((events.next().value as PullResult).element!.qName, 'title');
    assertEquals((events.next().value as PullResult).text, 'XML Parser for Deno');
    assertEquals((events.next().value as PullResult).name, 'end_element');
    while(true) {
        const { done } = events.next();
        if (done) {
            break;
        }
    }
});

Deno.test('PullParser XMLParseError', () => {
    const parser = new PullParser();
    const events = parser.parse('<a>b</aaaaaa>');
    assertEquals(events.next().value, { name: 'start_document' });
    assertEquals((events.next().value as PullResult).name, 'start_element');
    assertEquals((events.next().value as PullResult).name, 'text');
    assertEquals((events.next().value as PullResult).name, 'error');
    assertEquals(events.next().done, true);
});

Deno.test('PullParser iterator throws Error', () => {
    const parser = new PullParser();
    const events = parser.parse('<a>b</a>');
    assertEquals(events.next().value, { name: 'start_document' });
    assertThrows(() => events.throw(new Error()));
    assertEquals(events.next().done, true);
});

Deno.test('PullParser iterator throws XMLParseError', () => {
    const parser = new PullParser();
    const events = parser.parse('<a>b</a>');
    assertEquals(events.next().value, { name: 'start_document' });
    assertEquals(
        (events.throw(new XMLParseError('', new XMLParseContext())).value as PullResult).name,
        'error',
    );
    assertEquals(events.next().done, true);
});

Deno.test('PullParser iterator returns', () => {
    const parser = new PullParser();
    const events = parser.parse('<a>b</a>');
    assertEquals(events.next().value, { name: 'start_document' });
    assertEquals(events.return().done, true);
    assertEquals(events.next().done, true);
});

Deno.test('README', async () => {
    const parser = new PullParser();
    const uint8Array = await Deno.readFile('parser_test.xml');
    const events = parser.parse(uint8Array);
    const event = events.next();
    if (event.value) {
        console.log(event.value.name);
    }
    console.log([...events].filter(({ name }) => {
        return name === 'text';
    }).map(({ text, cdata }) => {
        return cdata ? `<![CDATA[${text}]]>` : text;
    }));
})