const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function fixture(platform) {
  const source = fs.readFileSync('components/VideoInfo.tsx', 'utf8');
  const ast = ts.createSourceFile('VideoInfo.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'VideoInfo');
  const state = [];
  const effects = [];
  let cursor = 0;
  const context = {
    React: {
      createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
      useState(initial) {
        const index = cursor++;
        if (!(index in state)) state[index] = initial;
        return [state[index], value => { state[index] = typeof value === 'function' ? value(state[index]) : value; }];
      },
      useEffect(fn, deps) { effects.push({ fn, deps }); },
      useCallback: fn => fn,
    },
    useRouter: () => ({ push() {} }),
    useAuthStore: () => ({ isFollowing: () => false, user: { id: 'viewer' } }),
    useVideoStore: () => ({ isAttending: () => null }),
    formatRelativeUploadTime: () => '1d ago',
    resolvedDistanceCache: new Map(),
    AttendanceStatus: { GOING: 'going' },
    Platform: { OS: platform },
    Colors: { dark: { gradients: { primary: ['blue', 'purple'] } } },
    styles: new Proxy({}, { get: (_, name) => name }),
  };
  for (const name of ['View', 'Text', 'TouchableOpacity', 'ScrollView', 'AvatarImage', 'UserPlus', 'UserCheck', 'LinearGradient', 'Users', 'UserTagItem', 'Calendar', 'MapPin', 'UserCircle', 'Ticket', 'ProductsModal']) context[name] = name;
  vm.createContext(context);
  const code = component.getText(ast).replace('export default ', '') + '\nglobalThis.render = VideoInfo;';
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 } }).outputText, context);
  const video = { id: 'one', userId: 'creator', user: { username: 'creator' }, caption: 'A long caption '.repeat(100), eventName: 'Event '.repeat(100), location: { name: 'Address '.repeat(100) }, products: [{ id: 'ticket' }] };
  return {
    video,
    render() { cursor = 0; effects.length = 0; return context.render({ video }); },
    resetForVideo() { effects.find(effect => effect.deps.length === 1 && effect.deps[0] === video.id).fn(); },
  };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return [tree, ...tree.children.flatMap(nodes)];
}
for (const platform of ['android', 'ios']) {
  test(`${platform}: long details are hidden, can be opened and closed, and reset for another video`, () => {
    const f = fixture(platform);
    let tree = f.render();
    const toggle = () => nodes(tree).find(n => n.props.accessibilityRole === 'button');
    assert.equal(toggle().props.accessibilityState.expanded, false);
    assert.equal(nodes(tree).some(n => n.type === 'ScrollView'), false);
    assert.ok(nodes(tree).some(n => n.children.includes('Attend')));
    assert.ok(nodes(tree).some(n => n.children.includes('Tickets')));
    toggle().props.onPress();
    tree = f.render();
    assert.equal(toggle().props.accessibilityState.expanded, true);
    const panel = nodes(tree).find(n => n.type === 'ScrollView');
    assert.equal(panel.props.nestedScrollEnabled, true);
    assert.ok(nodes(panel).some(n => n.children.includes(f.video.caption)));
    assert.ok(nodes(panel).some(n => n.children.includes(f.video.eventName)));
    assert.ok(nodes(panel).some(n => n.children.includes(f.video.location.name)));
    toggle().props.onPress();
    tree = f.render();
    assert.equal(nodes(tree).some(n => n.type === 'ScrollView'), false);
    toggle().props.onPress();
    f.video.id = 'two';
    f.render();
    f.resetForVideo();
    tree = f.render();
    assert.equal(toggle().props.accessibilityState.expanded, false);
  });
}
