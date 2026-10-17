import { blockStyleCss } from './block-style.css';

describe('blockStyleCss', () => {
  it('serializes allowed style values and rejects CSS injection', () => {
    expect(blockStyleCss({ fontFamily: 'Arial', fontSizePt: 18, color: '#abc', align: 'center', lineHeight: 1.5 })).toContain("font-family: 'Arial'");
    expect(blockStyleCss({ fontFamily: 'Arial; color:red' as never, color: 'red' })).toBe('');
  });
});
