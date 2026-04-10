import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { getDisplayName, getDisplayRole, logout } from '../utils/auth';

type Props = {
  /** 默认：工作台顶栏圆角头像；compact：制课页小圆头像 */
  variant?: 'default' | 'compact';
};

const UserMenuButton = ({ variant = 'default' }: Props) => {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const handleLogout = () => {
    logout();
    setOpen(false);
    navigate('/');
  };

  const name = getDisplayName();
  const role = getDisplayRole();
  const initial = name.slice(0, 1);

  const btnClass =
    variant === 'compact'
      ? 'w-8 h-8 rounded-full bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center cursor-pointer flex-shrink-0 text-white text-[11px] font-bold shadow-md shadow-blue-200/50 border-0'
      : 'w-9 h-9 rounded-xl bg-gradient-to-br from-blue-500 to-blue-700 flex items-center justify-center cursor-pointer shadow-md shadow-blue-200 text-white text-xs font-bold border-0';

  return (
    <div className="relative flex-shrink-0" ref={wrapRef}>
      <button type="button" className={btnClass} onClick={() => setOpen(!open)} aria-expanded={open} aria-haspopup="menu">
        {initial}
      </button>

      {open && (
        <div
          className="absolute top-full right-0 mt-1.5 z-40 w-52 rounded-xl border border-gray-100 bg-white py-1 shadow-xl shadow-gray-200/80"
          role="menu"
        >
          <div className="px-3 py-2.5 border-b border-gray-50">
            <p className="text-xs font-semibold text-gray-900 truncate">{name}</p>
            <p className="text-[10px] text-gray-500 mt-0.5 truncate">{role || '已登录'}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={handleLogout}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left text-xs text-gray-700 hover:bg-red-50 hover:text-red-600 transition-colors cursor-pointer"
          >
            <i className="ri-logout-box-r-line text-sm" />
            退出登录
          </button>
        </div>
      )}
    </div>
  );
};

export default UserMenuButton;
