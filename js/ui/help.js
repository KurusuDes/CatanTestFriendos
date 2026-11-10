import { h } from './dom.js';
import { MODES } from '../engine/config.js';

export const REPO_URL = 'https://github.com/KurusuDes/CatanTestFriendos';
const repoLink = () => h('a', { href: REPO_URL, target: '_blank', rel: 'noopener' }, 'Mã nguồn trên GitHub');

// the credit line under the main menu: copies of the game usually keep it, so the link travels with them
export function creditLine() {
  return h('div', { class: 'credits' }, 'Katanittes, của Sowtank · ', repoLink(), ' · dự án của người hâm mộ, không chính thức');
}

export function showHelp() {
  const close = () => ov.remove();
  const ov = h('div', { class: 'overlay', onclick: e => e.target === ov && close() },
    h('div', { class: 'modal help-body', style: { width: 'min(720px,100%)' } },
      h('h2', null, '📖 Cách chơi'),
      h('p', null, 'Xây nhà, thành phố và đường. Ai đạt đủ điểm chiến thắng của ván trước (mặc định là 10) thì thắng.'),
      h('h3', null, 'Lượt chơi'),
      h('ul', null,
        h('li', null, '🎲 Tung xúc xắc: mỗi ô mang số đó cho tài nguyên tới các nhà (1) và thành phố (2) nằm sát nó.'),
        h('li', null, '🏗️ Giá xây: đường 🌲🧱 · nhà 🌲🧱🐑🌾 · thành phố 🌾🌾⛰️⛰️⛰️ · thẻ 🐑🌾⛰️.'),
        h('li', null, '🤝 Giao dịch với ngân hàng (4:1, hoặc lời hơn nhờ cảng 3:1 và 2:1) hoặc với người chơi khác.'),
        h('li', null, '🃏 Mỗi lượt dùng được một thẻ phát triển (không phải thẻ vừa mua trong lượt). Hiệp sĩ có thể dùng trước khi tung xúc xắc.')),
      h('h3', null, 'Số 7 và kẻ trộm'),
      h('ul', null,
        h('li', null, 'Khi ra 7, ai có nhiều thẻ hơn giới hạn phải bỏ một nửa.'),
        h('li', null, 'Sau đó bạn di chuyển kẻ trộm: nó chặn ô đó và bạn cướp một thẻ của người có nhà sát bên.')),
      h('h3', null, 'Điểm'),
      h('ul', null,
        h('li', null, 'Nhà 1 · Thành phố 2 · Thẻ điểm 1 (giấu kín).'),
        h('li', null, '🛣️ Con đường dài nhất (từ 5 đoạn liền nhau): 2 điểm. ⚔️ Đội quân lớn nhất (từ 3 hiệp sĩ): 2 điểm.')),
      h('h3', null, 'Chế độ Katanittes'),
      h('ul', null, MODES.map(m => h('li', null, h('b', null, `${m.icon} ${m.name}: `), m.desc))),
      h('h3', null, 'Điều khiển'),
      h('ul', null,
        h('li', null, 'Lăn chuột hoặc chụm hai ngón: phóng to/thu nhỏ. Kéo: di chuyển bản đồ.'),
        h('li', null, '🎲 Chạm «Tung xúc xắc» để tung ngay, hoặc nhấn giữ để lấy đà rồi thả ra: xúc xắc sẽ văng mạnh hơn.'),
        h('li', null, '🖱️ Nút chuột giữa: cắm một lá cờ nhỏ màu của bạn lên bản đồ cho mọi người cùng thấy. 😀: thả cảm xúc bay lên từ mọi công trình của bạn.'),
        h('li', null, 'Esc: hủy xây. 💡: nhờ bot khó gợi ý.')),
      h('h3', null, 'Thông tin'),
      h('ul', null,
        h('li', null, 'Katanittes là trò chơi của Sowtank. ', repoLink(), ' được mở miễn phí (giấy phép MIT): nếu dùng trong dự án khác, hãy ghi nguồn bản gốc và dẫn link tới kho mã.'),
        h('li', null, 'Dự án của người hâm mộ, không chính thức: không liên kết với Catan GmbH, CATAN Studio hay Kosmos. CATAN là thương hiệu của chủ sở hữu tương ứng.')),
      h('div', { class: 'row' }, h('button', { class: 'btn primary', onclick: close }, 'Đã hiểu!'))));
  document.body.append(ov);
}
