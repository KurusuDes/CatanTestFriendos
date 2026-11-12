import type { JSX } from 'preact';
import { MODES } from '@engine/config';
import { Button } from '@ui/components/Button';
import { Modal, openModal } from '@ui/components/Modal';
import { Emo, px } from '@ui/components/PixelIcon';

const REPO_URL = 'https://github.com/KurusuDes/CatanTestFriendos';
const RepoLink = (): JSX.Element => <a href={REPO_URL} target="_blank" rel="noopener">Mã nguồn trên GitHub</a>;

/** the credit line under the main menu: copies of the game usually keep it, so the link travels with them */
export function CreditLine(): JSX.Element {
  return <div class="credits">Katanittes, của Sowtank · <RepoLink /> · dự án của người hâm mộ, không chính thức</div>;
}

const L = ({ children }: { children: string }): JSX.Element => <li>{px(children, 20)}</li>;

export function HelpModal({ onClose }: { onClose: () => void }): JSX.Element {
  return (
    <Modal onClose={onClose} class="help-body" style={{ width: 'min(720px,100%)' }}>
      <h2><Emo size={28}>📖 Cách chơi</Emo></h2>
      <p>Xây nhà, thành phố và đường. Ai đạt đủ điểm chiến thắng của ván trước (mặc định là 10) thì thắng.</p>
      <h3>Lượt chơi</h3>
      <ul>
        <L>🎲 Tung xúc xắc: mỗi ô mang số đó cho tài nguyên tới các nhà (1) và thành phố (2) nằm sát nó.</L>
        <L>🏗️ Giá xây: đường 🌲🧱 · nhà 🌲🧱🐑🌾 · thành phố 🌾🌾⛰️⛰️⛰️ · thẻ 🐑🌾⛰️.</L>
        <L>🤝 Giao dịch với ngân hàng (4:1, hoặc lời hơn nhờ cảng 3:1 và 2:1) hoặc với người chơi khác.</L>
        <L>🃏 Mỗi lượt dùng được một thẻ phát triển (không phải thẻ vừa mua trong lượt). Hiệp sĩ có thể dùng trước khi tung xúc xắc.</L>
      </ul>
      <h3>Số 7 và kẻ trộm</h3>
      <ul>
        <li>Khi ra 7, ai có nhiều thẻ hơn giới hạn phải bỏ một nửa.</li>
        <li>Sau đó bạn di chuyển kẻ trộm: nó chặn ô đó và bạn cướp một thẻ của người có nhà sát bên.</li>
      </ul>
      <h3>Điểm</h3>
      <ul>
        <li>Nhà 1 · Thành phố 2 · Thẻ điểm 1 (giấu kín).</li>
        <L>🛣️ Con đường dài nhất (từ 5 đoạn liền nhau): 2 điểm. ⚔️ Đội quân lớn nhất (từ 3 hiệp sĩ): 2 điểm.</L>
      </ul>
      <h3>Chế độ Katanittes</h3>
      <ul>
        {MODES.map(m => <li key={m.id}><b>{px(`${m.icon} ${m.name}: `, 20)}</b>{px(m.desc, 20)}</li>)}
      </ul>
      <h3>Điều khiển</h3>
      <ul>
        <li>Lăn chuột hoặc chụm hai ngón: phóng to/thu nhỏ. Kéo: di chuyển bản đồ.</li>
        <L>🎲 Chạm «Tung xúc xắc» để tung ngay, hoặc nhấn giữ để lấy đà rồi thả ra: xúc xắc sẽ văng mạnh hơn.</L>
        <L>🖱️ Nút chuột giữa: cắm một lá cờ nhỏ màu của bạn lên bản đồ cho mọi người cùng thấy.</L>
        <L>Esc: hủy xây. 💡: nhờ bot khó gợi ý.</L>
      </ul>
      <h3>Thông tin</h3>
      <ul>
        <li>Katanittes là trò chơi của Sowtank. <RepoLink /> được mở miễn phí (giấy phép MIT): nếu dùng trong dự án khác, hãy ghi nguồn bản gốc và dẫn link tới kho mã.</li>
        <li>Dự án của người hâm mộ, không chính thức: không liên kết với Catan GmbH, CATAN Studio hay Kosmos. CATAN là thương hiệu của chủ sở hữu tương ứng.</li>
      </ul>
      <div class="row"><Button variant="primary" onClick={onClose}>Đã hiểu!</Button></div>
    </Modal>
  );
}

/** Opens the help over whatever screen is up (the menu and the in-game menu both call this). */
export function showHelp(): void {
  openModal(close => <HelpModal onClose={close} />);
}
