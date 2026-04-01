import React, { useState, useEffect, createContext, useContext, useMemo, useCallback, useRef } from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  googleProvider,
  auth,
  db,
  OperationType,
  handleFirestoreError,
  FirebaseUser
} from './firebase';
import {
  collection,
  doc,
  onSnapshot,
  setDoc,
  deleteDoc,
  query,
  where,
  getDoc,
  getDocs,
  arrayUnion,
  arrayRemove
} from 'firebase/firestore';
import {
  startOfWeek,
  format,
  isSameDay,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  getDay,
  subMonths,
  addMonths,
  isSameMonth,
  endOfWeek
} from 'date-fns';
import { vi } from 'date-fns/locale';
import {
  Users,
  Calendar,
  Briefcase,
  LogOut,
  Plus,
  Trash2,
  ChevronLeft,
  ChevronRight,
  Bell,
  Clock,
  CheckCircle2,
  Grid3X3,
  List as ListIcon,
  X,
  Copy,
  UserPlus,
  LogIn,
  Shield,
  Zap,
  Timer,
  Sun,
  Sunset,
  Coffee,
  CheckCheck,
  AlertCircle,
  Undo2,
  Settings,
  ChevronDown,
} from 'lucide-react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { motion, AnimatePresence } from 'motion/react';

// --- Utilities ---
function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

function generateInviteCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// --- Types ---
type Role = 'leader' | 'member';

interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  teamIds?: string[];
}

interface TeamMember {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  joinedAt: string;
}

interface Team {
  id: string;
  name: string;
  ownerId: string;
  inviteCode: string;
  createdAt: string;
}

interface Project {
  id: string;
  name: string;
  teamId: string;
}

type SlotType = 'half-day' | 'hourly';

interface Slot {
  id: string;
  memberId: string;
  projectId: string;
  day: number; // 0=Sun, 1=Mon, ..., 6=Sat
  weekStart: string; // ISO string for Monday
  teamId: string;
  // Slot type
  type: SlotType;
  shift?: 'morning' | 'afternoon'; // for half-day
  startHour?: number; // for hourly, e.g. 9
  endHour?: number;   // for hourly, e.g. 11 (exclusive)
}

// Work hours config — Sáng: 9:00–11:45, Chiều: 13:15–18:15
const WORK_START = 9;           // 9:00
const WORK_END = 18.25;         // 18:15
const MORNING_START = 9;        // 9:00
const MORNING_END = 11.75;      // 11:45
const LUNCH_START = 11.75;      // 11:45
const LUNCH_END = 13.25;        // 13:15
const AFTERNOON_START = 13.25;  // 13:15
const AFTERNOON_END = 18.25;    // 18:15

// Format decimal hour → "H:mm"
function fmtHour(h: number): string {
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}:${mm.toString().padStart(2, '0')}`;
}

// Member color palette for timeline
const MEMBER_COLORS = [
  { bg: 'bg-blue-500', light: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200 ring-blue-500' },
  { bg: 'bg-violet-500', light: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200 ring-violet-500' },
  { bg: 'bg-emerald-500', light: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200 ring-emerald-500' },
  { bg: 'bg-amber-500', light: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200 ring-amber-500' },
  { bg: 'bg-rose-500', light: 'bg-rose-50', text: 'text-rose-700', border: 'border-rose-200 ring-rose-500' },
  { bg: 'bg-cyan-500', light: 'bg-cyan-50', text: 'text-cyan-700', border: 'border-cyan-200 ring-cyan-500' },
  { bg: 'bg-orange-500', light: 'bg-orange-50', text: 'text-orange-700', border: 'border-orange-200 ring-orange-500' },
  { bg: 'bg-pink-500', light: 'bg-pink-50', text: 'text-pink-700', border: 'border-pink-200 ring-pink-500' },
];

function getMemberColor(index: number) {
  return MEMBER_COLORS[index % MEMBER_COLORS.length];
}

// Get effective start/end hours for a slot
function getSlotHours(slot: Slot): { start: number; end: number } {
  if (slot.type === 'hourly') {
    const s = slot.startHour ?? MORNING_START;
    const e = slot.endHour ?? AFTERNOON_END;
    return { start: Math.min(s, e), end: Math.max(s, e) };
  }
  if (slot.shift === 'morning') return { start: MORNING_START, end: MORNING_END };
  return { start: AFTERNOON_START, end: AFTERNOON_END };
}

// Check if two time ranges overlap
function hoursOverlap(s1: number, e1: number, s2: number, e2: number): boolean {
  return s1 < e2 && e1 > s2;
}

// Compute free time ranges for a member given their booked slots
function getFreeRanges(memberSlots: Slot[]): { start: number; end: number; label: string }[] {
  // Build booked intervals
  const booked = memberSlots.map(s => getSlotHours(s)).sort((a, b) => a.start - b.start);
  const sessions = [
    { start: MORNING_START, end: MORNING_END, label: 'Full sáng' },
    { start: AFTERNOON_START, end: AFTERNOON_END, label: 'Full chiều' },
  ];
  const free: { start: number; end: number; label: string }[] = [];
  for (const session of sessions) {
    let cursor = session.start;
    for (const b of booked) {
      if (b.start >= session.end) break;
      if (b.end <= cursor) continue;
      if (b.start > cursor) {
        free.push({ start: cursor, end: Math.min(b.start, session.end), label: `${fmtHour(cursor)}–${fmtHour(Math.min(b.start, session.end))}` });
      }
      cursor = Math.max(cursor, b.end);
    }
    if (cursor < session.end) {
      // Full session free
      if (cursor === session.start) {
        free.push({ start: cursor, end: session.end, label: session.label });
      } else {
        free.push({ start: cursor, end: session.end, label: `${fmtHour(cursor)}–${fmtHour(session.end)}` });
      }
    }
  }
  return free.sort((a, b) => a.start - b.start);
}

// --- Toast System ---
type ToastType = 'success' | 'error' | 'undo';
interface Toast {
  id: string;
  type: ToastType;
  message: string;
  onUndo?: () => void;
}

const ToastContext = React.createContext<{
  showToast: (msg: string, type?: ToastType, onUndo?: () => void) => void;
}>({
  showToast: () => { },
});

function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success', onUndo?: () => void) => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev, { id, type, message, onUndo }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), type === 'undo' ? 5000 : 3000);
  }, []);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col gap-2 items-center pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className={cn(
                "flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl text-sm font-bold pointer-events-auto",
                toast.type === 'success' && "bg-slate-900 text-white",
                toast.type === 'error' && "bg-red-600 text-white",
                toast.type === 'undo' && "bg-slate-900 text-white",
              )}
            >
              {toast.type === 'success' && <CheckCheck className="w-4 h-4 text-emerald-400 flex-shrink-0" />}
              {toast.type === 'error' && <AlertCircle className="w-4 h-4 text-red-200 flex-shrink-0" />}
              {toast.type === 'undo' && <Trash2 className="w-4 h-4 text-slate-500 flex-shrink-0" />}
              <span>{toast.message}</span>
              {toast.onUndo && (
                <button
                  onClick={() => { toast.onUndo!(); dismiss(toast.id); }}
                  className="flex items-center gap-1 ml-2 px-2.5 py-1 bg-white/15 hover:bg-white/25 rounded-lg text-xs transition-all"
                >
                  <Undo2 className="w-3 h-3" /> Hoàn tác
                </button>
              )}
              <button onClick={() => dismiss(toast.id)} className="ml-1 text-white/50 hover:text-white transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

// --- Context ---
interface AppContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  team: Team | null;
  teamRole: Role | null;
  isLeader: boolean;
}

const AppContext = createContext<AppContextType>({
  user: null, profile: null, loading: true,
  team: null, teamRole: null, isLeader: false
});

// --- Components ---

// Renders a compact slot pill for calendar cell
const SlotPill: React.FC<{ slot: Slot; project?: Project; color: ReturnType<typeof getMemberColor> }> = ({ slot, project, color }) => {
  const label = project?.name ?? 'Booked';

  if (slot.type === 'hourly') {
    const { start, end } = getSlotHours(slot);
    return (
      <div className={cn(
        "flex flex-col justify-center px-1.5 py-1.5 rounded-lg border shadow-sm transition-all duration-200 relative overflow-hidden h-[46px]",
        "hover:shadow-md hover:-translate-y-0.5 group",
        color.light, color.border
      )}>
        <div className={cn("absolute left-0 top-0 bottom-0 w-1", color.bg)} />
        <div className="flex items-center gap-1.5 ml-1">
          <Timer className={cn("w-3 h-3 flex-shrink-0", color.text)} />
          <span className={cn("text-xs font-bold truncate", color.text)}>{label}</span>
        </div>
        <span className="text-[10px] font-semibold text-slate-500 ml-1 mt-0.5 leading-none">
          {fmtHour(start)} - {fmtHour(end)}
        </span>
      </div>
    );
  }

  const isAM = slot.shift === 'morning';
  return (
    <div className={cn(
      "flex items-center gap-1.5 px-1.5 py-1.5 rounded-lg border shadow-sm transition-all duration-200 relative overflow-hidden h-[46px]",
      "hover:shadow-md hover:-translate-y-0.5 group",
      isAM ? "bg-amber-50 border-amber-200" : "bg-violet-50 border-violet-200"
    )}>
      <div className={cn("absolute left-0 top-0 bottom-0 w-1", isAM ? "bg-amber-400" : "bg-violet-400")} />
      <div className={cn("w-5 h-5 rounded flex items-center justify-center flex-shrink-0 ml-1", isAM ? "bg-amber-100 text-amber-700" : "bg-violet-100 text-violet-700")}>
        {isAM ? <Sun className="w-3 h-3" /> : <Sunset className="w-3 h-3" />}
      </div>
      <div className="flex flex-col min-w-0">
        <span className={cn("text-xs font-bold truncate leading-tight", isAM ? "text-amber-900" : "text-violet-900")}>
          {label}
        </span>
        <span className={cn("text-[10px] font-semibold opacity-70 leading-tight", isAM ? "text-amber-700" : "text-violet-700")}>
          {isAM ? 'Sáng' : 'Chiều'}
        </span>
      </div>
    </div>
  );
}

function MonthlyCalendar({ currentMonth, slots, members, projects, isLeader, profile, onDayClick }: {
  currentMonth: Date;
  slots: Slot[];
  members: TeamMember[];
  projects: Project[];
  isLeader: boolean;
  profile: UserProfile | null;
  onDayClick?: (date: Date) => void;
}) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const startDate = startOfWeek(monthStart, { weekStartsOn: 0 });
  const endDate = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });
  const dayNames = ['CN', 'THỨ 2', 'THỨ 3', 'THỨ 4', 'THỨ 5', 'THỨ 6', 'THỨ 7'];
  const isWeekend = (col: number) => col === 0 || col === 6; // CN=0, T7=6

  // Build member index map for color assignment
  const memberColorMap = useMemo(() => {
    const map: Record<string, number> = {};
    members.forEach((m, i) => { map[m.uid] = i; });
    return map;
  }, [members]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-white border border-slate-200 rounded-[32px] overflow-hidden flex flex-col h-full min-h-[850px] shadow-2xl shadow-slate-200/50"
    >
      <div className="grid grid-cols-7 border-b border-slate-200">
        {dayNames.map((day, col) => (
          <div key={day} className={cn(
            "py-4 text-center text-xs font-bold uppercase tracking-[0.2em] border-r border-slate-200 last:border-r-0",
            isWeekend(col) ? "text-rose-400 bg-rose-50/60" : "text-slate-500 bg-slate-50/30"
          )}>
            {day}
            {isWeekend(col) && <span className="block text-xs font-medium tracking-normal normal-case mt-0.5 opacity-70">Nghỉ</span>}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 flex-1">
        {calendarDays.map((date, i) => {
          const col = i % 7;
          const weekend = isWeekend(col);
          const isCurrMonth = isSameMonth(date, monthStart);
          const isToday = isSameDay(date, new Date());
          const weekStart = startOfWeek(date, { weekStartsOn: 1 });
          const dayIndex = getDay(date);

          const daySlots = slots.filter(s =>
            s.day === dayIndex && s.weekStart === weekStart.toISOString()
          );

          // Sort slots by start hour
          const sortedDaySlots = [...daySlots].sort((a, b) => getSlotHours(a).start - getSlotHours(b).start);

          const dayLabel = format(date, 'd');

          // For member view: only my slots sorted
          const mySlots = isLeader ? [] : sortedDaySlots.filter(s => s.memberId === profile?.uid);

          // For leader: compute free time per member
          const allMemberFreeMap = useMemo ? null : null; // computed inline below

          return (
            <motion.div
              key={date.toISOString()}
              whileHover={!weekend ? { backgroundColor: "rgba(248, 250, 252, 0.8)" } : {}}
              onClick={() => !weekend && onDayClick?.(date)}
              className={cn(
                "border-r border-b border-slate-200 transition-all relative group flex flex-col min-h-[150px]",
                weekend ? "bg-rose-50/30 cursor-default" : "cursor-pointer",
                !isCurrMonth && "opacity-40",
                col === 6 && "border-r-0"
              )}
            >
              {/* Day number */}
              <div className="flex flex-col items-center py-2">
                <span className={cn(
                  "text-xs font-bold w-7 h-7 flex items-center justify-center rounded-full transition-all duration-300",
                  isToday
                    ? "bg-blue-600 text-white shadow-lg shadow-blue-200 scale-110"
                    : weekend
                      ? "text-rose-400"
                      : "text-slate-600 group-hover:text-blue-600 group-hover:bg-blue-50",
                  !isCurrMonth && !isToday && "text-slate-400"
                )}>
                  {dayLabel}
                </span>
              </div>

              {/* Weekend overlay */}
              {weekend && (
                <div className="flex-1 flex items-center justify-center pb-4">
                  <span className="text-xs font-bold text-rose-300 uppercase tracking-widest">Ngày nghỉ</span>
                </div>
              )}

              {/* Slots / Free time — only for weekdays */}
              {!weekend && (
                <div className="flex-1 px-1.5 pb-2 flex flex-col gap-1 overflow-hidden">
                  {isLeader ? (
                    sortedDaySlots.length > 0 ? (
                      <>
                        {sortedDaySlots.slice(0, 3).map(slot => {
                          const project = projects.find(p => p.id === slot.projectId);
                          const colorIdx = memberColorMap[slot.memberId] ?? 0;
                          return <SlotPill key={slot.id} slot={slot} project={project} color={getMemberColor(colorIdx)} />;
                        })}
                        {sortedDaySlots.length > 3 && (
                          <div className="text-xs font-bold text-slate-500 px-1">+{sortedDaySlots.length - 3} more</div>
                        )}
                      </>
                    ) : (
                      <div className="flex-1 flex items-center justify-center pb-2 gap-1.5 text-rose-300 transition-all rounded-xl group-hover:bg-slate-50">
                        <Coffee className="w-4 h-4 opacity-70" />
                        <span className="text-xs font-bold uppercase tracking-widest">Free</span>
                      </div>
                    )
                  ) : (
                    mySlots.length > 0 ? (
                      mySlots.map(slot => {
                        const project = projects.find(p => p.id === slot.projectId);
                        return <SlotPill key={slot.id} slot={slot} project={project} color={getMemberColor(0)} />;
                      })
                    ) : (
                      <div className="flex-1 flex items-center justify-center pb-2 gap-1.5 text-rose-300 transition-all rounded-xl group-hover:bg-slate-50">
                        <Coffee className="w-4 h-4 opacity-70" />
                        <span className="text-xs font-bold uppercase tracking-widest">Free</span>
                      </div>
                    )
                  )}
                </div>
              )}

              {/* Hover hint for leader on weekday */}
              {isLeader && !weekend && (
                <div className="absolute inset-0 bg-blue-600/5 opacity-0 group-hover:opacity-100 transition-opacity rounded-sm flex items-end justify-center pb-2 pointer-events-none">
                  <span className="text-xs font-bold text-blue-500 bg-white/80 px-2 py-0.5 rounded-full">Click to manage</span>
                </div>
              )}
            </motion.div>
          );
        })}
      </div>
    </motion.div>
  );
}

// --- Day Timeline Modal ---
// Full timeline view for a single day, leader can assign slots
function DayTimelineModal({ date, slots, members, projects, teamId, preselectedMemberId, onClose }: {
  date: Date;
  slots: Slot[];
  members: TeamMember[];
  projects: Project[];
  teamId: string;
  preselectedMemberId?: string;
  onClose: () => void;
}) {
  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
  const dayIndex = getDay(date);
  const daySlots = slots.filter(s => s.day === dayIndex && s.weekStart === weekStart.toISOString());
  const allMembers = members;
  const teamMembers = allMembers.filter(m => m.role === 'member');

  // Display hours: whole hours + special endpoints 11:45 and 13:15
  const morningHours = [9, 10, 11, 11.75];           // 9:00, 10:00, 11:00, 11:45
  const afternoonHours = [13.25, 14, 15, 16, 17, 18]; // 13:15, 14:00, ..., 18:00
  const displayHours = [...morningHours, 'lunch' as const, ...afternoonHours];

  // Default to preselected member, fallback to first member
  const [focusedMemberId, setFocusedMemberId] = useState<string>(
    preselectedMemberId ?? teamMembers[0]?.uid ?? ''
  );
  const [assignMode, setAssignMode] = useState<'half-day' | 'hourly'>('half-day');
  const [selectedProject, setSelectedProject] = useState<string>('');
  const [startHour, setStartHour] = useState<number>(MORNING_START);
  const [endHour, setEndHour] = useState<number>(MORNING_END);
  const [selectedShift, setSelectedShift] = useState<'morning' | 'afternoon'>('morning');
  const [saving, setSaving] = useState(false);
  const [conflictMsg, setConflictMsg] = useState<string>('');
  const [assignSuccess, setAssignSuccess] = useState(false);
  const { showToast } = useContext(ToastContext);

  const focusedMember = allMembers.find(m => m.uid === focusedMemberId);
  const focusedMemberIndex = allMembers.findIndex(m => m.uid === focusedMemberId);
  const focusedColor = getMemberColor(focusedMemberIndex);
  const focusedSlots = daySlots
    .filter(s => s.memberId === focusedMemberId)
    .sort((a, b) => getSlotHours(a).start - getSlotHours(b).start);

  const memberSlotMap = useMemo(() => {
    const map: Record<string, Slot[]> = {};
    allMembers.forEach(m => { map[m.uid] = daySlots.filter(s => s.memberId === m.uid); });
    return map;
  }, [daySlots, allMembers]);

  function getSlotAtHour(memberId: string, hour: number): Slot | undefined {
    return memberSlotMap[memberId]?.find(s => {
      const { start, end } = getSlotHours(s);
      return hour >= start && hour < end;
    });
  }

  // Check if proposed assignment conflicts with existing slots for focused member
  function checkConflict(): string {
    const existing = memberSlotMap[focusedMemberId] ?? [];
    let newStart: number, newEnd: number;
    if (assignMode === 'half-day') {
      newStart = selectedShift === 'morning' ? MORNING_START : AFTERNOON_START;
      newEnd = selectedShift === 'morning' ? MORNING_END : AFTERNOON_END;
    } else {
      newStart = startHour;
      newEnd = endHour;
    }
    for (const s of existing) {
      const { start, end } = getSlotHours(s);
      if (hoursOverlap(newStart, newEnd, start, end)) {
        return `Trùng với slot ${fmtHour(start)}–${fmtHour(end)}. Xóa slot đó trước.`;
      }
    }
    return '';
  }

  const handleAssign = async () => {
    if (!focusedMemberId || !selectedProject) return;
    const conflict = checkConflict();
    if (conflict) { setConflictMsg(conflict); return; }
    setConflictMsg('');
    setSaving(true);
    try {
      if (assignMode === 'half-day') {
        const slotId = `${focusedMemberId}_${dayIndex}_${selectedShift}_${weekStart.toISOString()}`;
        await setDoc(doc(db, 'slots', slotId), {
          id: slotId, memberId: focusedMemberId, projectId: selectedProject,
          day: dayIndex, weekStart: weekStart.toISOString(), teamId,
          type: 'half-day', shift: selectedShift,
        } as Slot);
      } else {
        const slotId = `${focusedMemberId}_${dayIndex}_${startHour}_${endHour}_${weekStart.toISOString()}`;
        await setDoc(doc(db, 'slots', slotId), {
          id: slotId, memberId: focusedMemberId, projectId: selectedProject,
          day: dayIndex, weekStart: weekStart.toISOString(), teamId,
          type: 'hourly', startHour, endHour,
        } as Slot);
      }
      setSelectedProject('');
      setAssignSuccess(true);
      showToast(`Đã assign ${focusedMember?.displayName.split(' ').pop()} ✓`, 'success');
      setTimeout(() => setAssignSuccess(false), 1500);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'slots');
      showToast('Lỗi khi lưu slot', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteSlot = async (slotId: string, slotData?: Slot) => {
    setConflictMsg('');
    // Optimistic delete with undo
    try {
      await deleteDoc(doc(db, 'slots', slotId));
      showToast('Slot đã xóa', 'undo', slotData ? async () => {
        try { await setDoc(doc(db, 'slots', slotId), slotData); }
        catch { showToast('Không thể hoàn tác', 'error'); }
      } : undefined);
    }
    catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `slots/${slotId}`);
      showToast('Lỗi khi xóa slot', 'error');
    }
  };

  // Available hourly options: whole hours + special endpoints only
  const hourlyOptions = [9, 10, 11, 11.75, 13.25, 14, 15, 16, 17, 18, 18.25];

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm"
      onClick={e => e.target === e.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 10 }}
        className="bg-white rounded-[28px] shadow-2xl w-full max-w-sm overflow-hidden flex flex-col"
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div>
            <h3 className="text-base font-black text-slate-900 tracking-tight">{format(date, 'EEEE, dd/MM', { locale: vi })}</h3>
            <p className="text-xs text-slate-500 font-bold mt-0.5">
              {fmtHour(MORNING_START)}–{fmtHour(MORNING_END)} · {fmtHour(AFTERNOON_START)}–{fmtHour(AFTERNOON_END)}
            </p>
          </div>
          <button onClick={onClose} className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center text-slate-500 hover:text-red-500 hover:border-red-100 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Assign Panel */}
        <div className="p-6 overflow-auto max-h-[80vh]">
          {!focusedMember ? (
            <div className="text-center text-slate-500 py-8 text-sm">Không tìm thấy member.</div>
          ) : (
            <>
              {/* Member header */}
              <div className={cn("flex items-center gap-3 p-3 rounded-2xl mb-5 border", focusedColor.light, focusedColor.border)}>
                <div className={cn("w-10 h-10 rounded-full flex items-center justify-center text-white font-black flex-shrink-0 text-base", focusedColor.bg)}>
                  {focusedMember.displayName[0]}
                </div>
                <div>
                  <p className={cn("text-sm font-black", focusedColor.text)}>{focusedMember.displayName}</p>
                  <p className="text-xs text-slate-500">{focusedSlots.length} slot hôm nay · {focusedMember.role === 'leader' ? 'Leader' : 'Member'}</p>
                </div>
              </div>

              {/* Mode toggle */}
              <div className="flex bg-slate-50 rounded-xl border border-slate-200 p-1 mb-4">
                <button
                  onClick={() => { setAssignMode('half-day'); setConflictMsg(''); }}
                  className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all",
                    assignMode === 'half-day' ? "bg-white text-slate-900 shadow border border-slate-200" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <Zap className="w-3 h-3" /> Half-day
                </button>
                <button
                  onClick={() => { setAssignMode('hourly'); setConflictMsg(''); }}
                  className={cn("flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold transition-all",
                    assignMode === 'hourly' ? "bg-white text-slate-900 shadow border border-slate-200" : "text-slate-500 hover:text-slate-800"
                  )}
                >
                  <Timer className="w-3 h-3" /> Hourly
                </button>
              </div>

              {/* Shift / Hour */}
              {assignMode === 'half-day' ? (
                <div className="mb-4">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 block">Buổi</label>
                  <div className="flex gap-2">
                    {(['morning', 'afternoon'] as const).map(s => (
                      <button key={s} onClick={() => { setSelectedShift(s); setConflictMsg(''); }}
                        className={cn("flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all flex items-center justify-center gap-1.5",
                          selectedShift === s ? "bg-slate-900 text-white border-slate-900" : "bg-white border-slate-200 text-slate-600 hover:border-slate-400"
                        )}
                      >
                        {s === 'morning'
                          ? <><Sun className="w-3 h-3" /> Sáng</>
                          : <><Sunset className="w-3 h-3" /> Chiều</>}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    {selectedShift === 'morning'
                      ? `${fmtHour(MORNING_START)} – ${fmtHour(MORNING_END)}`
                      : `${fmtHour(AFTERNOON_START)} – ${fmtHour(AFTERNOON_END)}`}
                  </p>
                </div>
              ) : (
                <div className="mb-4">
                  <label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 block">Giờ</label>
                  <div className="flex items-center gap-2">
                    <select value={startHour} onChange={e => { setStartHour(Number(e.target.value)); setConflictMsg(''); }}
                      className="flex-1 px-2 py-2 rounded-xl border border-slate-200 text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {hourlyOptions.filter(h => h < AFTERNOON_END - 0.25).map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                    <span className="text-slate-500 text-xs">→</span>
                    <select value={endHour} onChange={e => { setEndHour(Number(e.target.value)); setConflictMsg(''); }}
                      className="flex-1 px-2 py-2 rounded-xl border border-slate-200 text-xs font-bold bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      {hourlyOptions.filter(h => h > startHour && h > MORNING_START).map(h => <option key={h} value={h}>{fmtHour(h)}</option>)}
                    </select>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-1.5">{((endHour - startHour) * 60).toFixed(0)} phút</p>
                </div>
              )}

              {/* Project */}
              <div className="mb-4">
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 block">Dự án</label>
                <div className="flex flex-col gap-1.5">
                  {projects.map(p => (
                    <button key={p.id} onClick={() => { setSelectedProject(p.id); setConflictMsg(''); }}
                      className={cn("flex items-center gap-2 p-2.5 rounded-xl border transition-all text-left active:scale-[0.98]",
                        selectedProject === p.id ? "border-blue-600 bg-blue-600 text-white" : "border-slate-200 bg-white hover:border-slate-200 text-slate-800"
                      )}
                    >
                      <Briefcase className="w-3.5 h-3.5 flex-shrink-0" />
                      <span className="text-xs font-bold truncate">{p.name}</span>
                      {selectedProject === p.id && <CheckCheck className="w-3.5 h-3.5 ml-auto flex-shrink-0" />}
                    </button>
                  ))}
                </div>
              </div>

              {/* Conflict warning */}
              {conflictMsg && (
                <div className="mb-3 px-3 py-2 bg-red-50 border border-red-300 rounded-xl flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs font-bold text-red-600 leading-tight">{conflictMsg}</p>
                </div>
              )}

              <motion.button
                onClick={handleAssign}
                disabled={!selectedProject || saving}
                whileTap={!saving && selectedProject ? { scale: 0.97 } : {}}
                className={cn(
                  "w-full py-3 rounded-2xl font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-lg text-white flex items-center justify-center gap-2",
                  assignSuccess ? "bg-emerald-500" : focusedColor.bg, "hover:opacity-90"
                )}
              >
                {saving
                  ? <><Timer className="w-4 h-4 animate-spin" /> Saving...</>
                  : assignSuccess
                    ? <><CheckCheck className="w-4 h-4" /> Đã assign!</>
                    : `Assign → ${focusedMember.displayName.split(' ').pop()}`}
              </motion.button>

              {/* Existing slots */}
              {focusedSlots.length > 0 && (
                <div className="mt-5">
                  <p className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2">Đã book ({focusedSlots.length})</p>
                  <div className="flex flex-col gap-1.5">
                    {focusedSlots.map(slot => {
                      const project = projects.find(p => p.id === slot.projectId);
                      const { start, end } = getSlotHours(slot);
                      return (
                        <div key={slot.id} className={cn("flex items-center gap-2 p-2.5 rounded-xl border", focusedColor.light, focusedColor.border)}>
                          <div className="flex-1 min-w-0">
                            <p className={cn("text-xs font-black truncate", focusedColor.text)}>{project?.name ?? 'Booked'}</p>
                            <p className="text-[11px] text-slate-500">{fmtHour(start)} – {fmtHour(end)}</p>
                          </div>
                          <button
                            onClick={() => handleDeleteSlot(slot.id, slot)}
                            className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all flex-shrink-0"
                            title="Xóa slot này"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Free time ranges */}
              {(() => {
                const free = getFreeRanges(focusedSlots);
                if (free.length === 0) return null;
                return (
                  <div className="mt-4">
                    <p className="text-xs font-bold uppercase tracking-widest text-rose-300 mb-2">Đang rảnh</p>
                    <div className="flex flex-col gap-1">
                      {free.map((f, idx) => (
                        <div key={idx} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-transparent border border-dashed border-rose-200">
                          <span className="text-[11px] font-black text-rose-400">{f.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

// --- Login Screen ---
function LoginScreen() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white p-10 rounded-[32px] shadow-2xl max-w-md w-full text-center border border-gray-100"
      >
        <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mx-auto mb-8 shadow-xl shadow-blue-200">
          <Calendar className="w-10 h-10 text-white" />
        </div>
        <h1 className="text-3xl font-black text-gray-900 mb-2 tracking-tight">Team Scheduler</h1>
        <p className="text-gray-400 mb-10 font-medium">Quản lý time slot cho team của bạn.</p>
        <button
          onClick={() => signInWithPopup(auth, googleProvider)}
          className="w-full bg-slate-900 text-white py-4 rounded-2xl font-bold text-base hover:bg-slate-800 transition-all transform hover:scale-[1.02] active:scale-[0.98] shadow-lg flex items-center justify-center gap-3"
        >
          <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5 bg-white rounded-full p-0.5" alt="Google" />
          Đăng nhập với Google
        </button>
      </motion.div>
    </div>
  );
}

// --- Team Onboarding Screen (after login, no team yet) ---
function TeamOnboarding({
  profile,
  onTeamJoined,
  isModal = false,
  onClose,
  defaultMode = 'choose',
}: {
  profile: UserProfile;
  onTeamJoined: () => void;
  isModal?: boolean;
  onClose?: () => void;
  defaultMode?: 'choose' | 'create' | 'join';
}) {
  const [mode, setMode] = useState<'choose' | 'create' | 'join'>(defaultMode);
  const [teamName, setTeamName] = useState('');
  const [inviteCode, setInviteCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!teamName.trim()) return;
    setLoading(true);
    setError('');
    try {
      const teamId = Date.now().toString();
      const team: Team = {
        id: teamId,
        name: teamName.trim(),
        ownerId: profile.uid,
        inviteCode: generateInviteCode(),
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'teams', teamId), team);
      const member: TeamMember = {
        uid: profile.uid,
        email: profile.email,
        displayName: profile.displayName,
        role: 'leader',
        joinedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'teams', teamId, 'members', profile.uid), member);
      // Add teamId to user's teamIds array and set as active team
      await setDoc(doc(db, 'users', profile.uid), {
        currentTeamId: teamId,
        teamIds: arrayUnion(teamId),
      }, { merge: true });
      onTeamJoined();
    } catch (err) {
      setError('Tạo team thất bại. Thử lại nhé.');
    } finally {
      setLoading(false);
    }
  };

  const handleJoinTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteCode.trim()) return;
    setLoading(true);
    setError('');
    try {
      // Find team by invite code
      const q = query(collection(db, 'teams'), where('inviteCode', '==', inviteCode.trim().toUpperCase()));
      const snap = await getDocs(q);
      if (snap.empty) {
        setError('Mã invite không hợp lệ.');
        setLoading(false);
        return;
      }
      const teamDoc = snap.docs[0];
      const teamId = teamDoc.id;

      // Check if already a member — prevent overwriting existing role (e.g. leader → member)
      const existingMemberSnap = await getDoc(doc(db, 'teams', teamId, 'members', profile.uid));
      if (existingMemberSnap.exists()) {
        // Already in team — just switch active team
        await setDoc(doc(db, 'users', profile.uid), { currentTeamId: teamId }, { merge: true });
        onTeamJoined();
        return;
      }

      const member: TeamMember = {
        uid: profile.uid,
        email: profile.email,
        displayName: profile.displayName,
        role: 'member',
        joinedAt: new Date().toISOString(),
      };
      await setDoc(doc(db, 'teams', teamId, 'members', profile.uid), member);
      // Add teamId to user's teamIds array and set as active team
      await setDoc(doc(db, 'users', profile.uid), {
        currentTeamId: teamId,
        teamIds: arrayUnion(teamId),
      }, { merge: true });
      onTeamJoined();
    } catch (err) {
      setError('Join team thất bại. Thử lại nhé.');
    } finally {
      setLoading(false);
    }
  };

  const cardContent = (
    <motion.div
      initial={{ opacity: 0, y: isModal ? 0 : 20, scale: isModal ? 0.97 : 1 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.97 }}
      className={cn(
        "bg-white rounded-[32px] shadow-2xl w-full border border-gray-100",
        isModal ? "p-8 max-w-md relative" : "p-10 max-w-md"
      )}
    >
      {/* Close button for modal mode */}
      {isModal && onClose && (
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-all"
        >
          <X className="w-4 h-4" />
        </button>
      )}

      <div className="flex items-center gap-3 mb-8">
        <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-200">
          <Users className="w-6 h-6 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-black text-slate-900">
            {isModal ? 'Thêm team' : `Xin chào, ${profile.displayName.split(' ')[0]}!`}
          </h1>
          <p className="text-slate-500 text-sm">
            {isModal ? 'Tạo hoặc join thêm một team mới.' : 'Bắt đầu bằng cách tạo hoặc join team.'}
          </p>
        </div>
      </div>

      <AnimatePresence mode="wait">
        {mode === 'choose' && (
          <motion.div key="choose" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
            <button
              onClick={() => setMode('create')}
              className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-slate-200 hover:border-blue-300 hover:bg-blue-50/30 transition-all group"
            >
              <div className="w-12 h-12 bg-blue-50 rounded-xl flex items-center justify-center group-hover:bg-blue-200 transition-colors">
                <Plus className="w-6 h-6 text-blue-600" />
              </div>
              <div className="text-left">
                <p className="font-bold text-slate-900">Tạo team mới</p>
                <p className="text-sm text-slate-500">Bạn là leader, tạo team và mời members.</p>
              </div>
            </button>
            <button
              onClick={() => setMode('join')}
              className="w-full flex items-center gap-4 p-5 rounded-2xl border-2 border-slate-200 hover:border-emerald-300 hover:bg-emerald-50/30 transition-all group"
            >
              <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
                <LogIn className="w-6 h-6 text-emerald-600" />
              </div>
              <div className="text-left">
                <p className="font-bold text-slate-900">Join team</p>
                <p className="text-sm text-slate-500">Nhập invite code từ leader của bạn.</p>
              </div>
            </button>
          </motion.div>
        )}

        {mode === 'create' && (
          <motion.div key="create" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <button onClick={() => setMode('choose')} className="flex items-center gap-1 text-slate-500 text-sm mb-6 hover:text-slate-600 transition-colors">
              <ChevronLeft className="w-4 h-4" /> Quay lại
            </button>
            <h2 className="text-xl font-black text-slate-900 mb-6">Tạo team mới</h2>
            <form onSubmit={handleCreateTeam} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 block">Tên team</label>
                <input
                  type="text"
                  value={teamName}
                  onChange={e => setTeamName(e.target.value)}
                  placeholder="VD: BSS Dev Team"
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium"
                  autoFocus
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading || !teamName.trim()}
                className="w-full bg-blue-600 text-white py-3.5 rounded-2xl font-bold hover:bg-blue-700 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? 'Đang tạo...' : 'Tạo team'}
              </button>
            </form>
          </motion.div>
        )}

        {mode === 'join' && (
          <motion.div key="join" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
            <button onClick={() => setMode('choose')} className="flex items-center gap-1 text-slate-500 text-sm mb-6 hover:text-slate-600 transition-colors">
              <ChevronLeft className="w-4 h-4" /> Quay lại
            </button>
            <h2 className="text-xl font-black text-slate-900 mb-6">Join team</h2>
            <form onSubmit={handleJoinTeam} className="space-y-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-widest text-slate-500 mb-2 block">Invite Code</label>
                <input
                  type="text"
                  value={inviteCode}
                  onChange={e => setInviteCode(e.target.value.toUpperCase())}
                  placeholder="VD: ABC123"
                  className="w-full px-4 py-3 rounded-xl bg-slate-50 border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-500 text-sm font-mono font-bold tracking-widest uppercase"
                  maxLength={6}
                  autoFocus
                />
              </div>
              {error && <p className="text-red-500 text-sm">{error}</p>}
              <button
                type="submit"
                disabled={loading || inviteCode.length < 6}
                className="w-full bg-emerald-600 text-white py-3.5 rounded-2xl font-bold hover:bg-emerald-700 transition-all disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {loading ? 'Đang join...' : 'Join team'}
              </button>
            </form>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );

  if (isModal) {
    return (
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        />
        <div className="relative z-10 w-full max-w-md">
          {cardContent}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50 flex items-center justify-center p-4">
      {cardContent}
    </div>
  );
}

// --- Main App ---
export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [team, setTeam] = useState<Team | null>(null);
  const [teamRole, setTeamRole] = useState<Role | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [currentMonth, setCurrentMonth] = useState(startOfMonth(new Date()));
  const [needsTeam, setNeedsTeam] = useState(false);
  const [userTeamIds, setUserTeamIds] = useState<string[]>([]);
  // Ref keeps userTeamIds always fresh inside onSnapshot closures (avoids stale closure)
  const userTeamIdsRef = useRef<string[]>([]);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [teamModalMode, setTeamModalMode] = useState<'choose' | 'create' | 'join'>('choose');

  // Safety net: if loading is still true after 6s, force fallback to onboarding
  useEffect(() => {
    if (!loading) return;
    const t = setTimeout(() => {
      setLoading(false);
      setNeedsTeam(true);
    }, 6000);
    return () => clearTimeout(t);
  }, [loading]);

  // Auth + profile loading: single onSnapshot listener as source of truth
  useEffect(() => {
    let unsubUser: (() => void) | undefined;

    const unsubAuth = onAuthStateChanged(auth, async (u) => {
      if (unsubUser) { unsubUser(); unsubUser = undefined; }

      if (!u) {
        setUser(null);
        setProfile(null);
        setTeam(null);
        setTeamRole(null);
        setTeamMembers([]);
        setProjects([]);
        setSlots([]);
        setNeedsTeam(false);
        setLoading(false);
        return;
      }

      setUser(u);
      const userDocRef = doc(db, 'users', u.uid);

      try {
        // Ensure user doc exists
        const snap = await getDoc(userDocRef);
        if (!snap.exists()) {
          await setDoc(userDocRef, {
            uid: u.uid,
            email: u.email || '',
            displayName: u.displayName || 'Anonymous',
          });
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, `users/${u.uid}`);
        setLoading(false);
        return;
      }

      // Real-time listener on user doc to detect team removal
      unsubUser = onSnapshot(userDocRef, async (docSnap) => {
        if (!docSnap.exists()) { setLoading(false); return; }

        const data = docSnap.data() as UserProfile & { currentTeamId?: string; teamIds?: string[] };
        setProfile({ uid: data.uid, email: data.email, displayName: data.displayName, teamIds: data.teamIds });
        const freshTeamIds = data.teamIds ?? [];
        setUserTeamIds(freshTeamIds);
        userTeamIdsRef.current = freshTeamIds;

        // Resolve which team to actually load — verify membership for currentTeamId,
        // then fall through stale teamIds until we find a valid one or exhaust all.
        const allTeamIds: string[] = data.teamIds ?? [];
        const candidateIds = data.currentTeamId
          ? [data.currentTeamId, ...allTeamIds.filter(id => id !== data.currentTeamId)]
          : [...allTeamIds];

        let resolvedTeam: Team | null = null;
        let resolvedRole: Role | null = null;
        const staleIds: string[] = [];

        for (const tid of candidateIds) {
          try {
            const [tDoc, mDoc] = await Promise.all([
              getDoc(doc(db, 'teams', tid)),
              getDoc(doc(db, 'teams', tid, 'members', u.uid)),
            ]);
            if (tDoc.exists() && mDoc.exists()) {
              resolvedTeam = tDoc.data() as Team;
              resolvedRole = (mDoc.data() as TeamMember).role;
              break;
            } else {
              staleIds.push(tid);
            }
          } catch {
            // Network error on this team — skip, try next
            staleIds.push(tid);
          }
        }

        // Clean up stale teamIds using arrayRemove (safe for concurrent writes)
        // and update currentTeamId only if it changed
        const currentTeamChanged = data.currentTeamId !== resolvedTeam?.id;
        if (staleIds.length > 0 || currentTeamChanged) {
          try {
            const updates: Record<string, unknown> = {};
            // arrayRemove each stale id individually — atomic, no race condition
            if (staleIds.length > 0) updates.teamIds = arrayRemove(...staleIds);
            if (currentTeamChanged) updates.currentTeamId = resolvedTeam?.id ?? null;
            await setDoc(doc(db, 'users', u.uid), updates, { merge: true });
          } catch { /* best-effort cleanup, continue */ }
        }

        if (resolvedTeam && resolvedRole) {
          setTeam(resolvedTeam);
          setTeamRole(resolvedRole);
          setNeedsTeam(false);
        } else {
          setTeam(null);
          setTeamRole(null);
          setTeamMembers([]);
          setProjects([]);
          setSlots([]);
          setNeedsTeam(true);
        }

        setLoading(false);
      });
    });

    return () => {
      unsubAuth();
      if (unsubUser) unsubUser();
    };
  }, []);

  // Real-time listeners for team data
  useEffect(() => {
    if (!team || !user) return;

    const unsubMembers = onSnapshot(
      collection(db, 'teams', team.id, 'members'),
      snap => {
        const members = snap.docs.map(d => d.data() as TeamMember);

        // If current user no longer in members list, clear current team state immediately.
        // The userDoc onSnapshot will fire next (after leader updates the user doc) and
        // handle auto-switching to another team or redirecting to onboarding.
        const stillMember = members.some(m => m.uid === user.uid);
        if (!stillMember) {
          setTeam(null);
          setTeamRole(null);
          setTeamMembers([]);
          setProjects([]);
          setSlots([]);
          // If user has no other teams, show onboarding immediately instead of
          // waiting for userDoc onSnapshot — avoids a blank spinner flash.
          setNeedsTeam(userTeamIdsRef.current.filter(id => id !== team.id).length === 0);
          return;
        }

        members.sort((a, b) => {
          if (a.role === 'leader' && b.role !== 'leader') return -1;
          if (a.role !== 'leader' && b.role === 'leader') return 1;
          return a.displayName.localeCompare(b.displayName);
        });
        setTeamMembers(members);
      },
      err => handleFirestoreError(err, OperationType.LIST, `teams/${team.id}/members`)
    );

    const unsubProjects = onSnapshot(
      query(collection(db, 'projects'), where('teamId', '==', team.id)),
      snap => setProjects(snap.docs.map(d => d.data() as Project)),
      err => handleFirestoreError(err, OperationType.LIST, 'projects')
    );

    return () => { unsubMembers(); unsubProjects(); };
  }, [team]);

  // Real-time slots for current month
  useEffect(() => {
    if (!team) return;

    const monthStart = startOfMonth(currentMonth);
    const monthEnd = endOfMonth(currentMonth);
    const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });
    const weekStarts = Array.from(new Set(
      daysInMonth.map(d => startOfWeek(d, { weekStartsOn: 1 }).toISOString())
    ));
    if (weekStarts.length === 0) return;

    const q = query(
      collection(db, 'slots'),
      where('teamId', '==', team.id),
      where('weekStart', 'in', weekStarts)
    );
    const unsub = onSnapshot(q,
      snap => setSlots(snap.docs.map(d => d.data() as Slot)),
      err => handleFirestoreError(err, OperationType.LIST, 'slots')
    );
    return unsub;
  }, [team, currentMonth]);

  // Notification for members
  useEffect(() => {
    if (!profile || teamRole !== 'member' || !team) return;
    const interval = setInterval(() => {
      const now = new Date();
      const day = now.getDay();
      if (day < 1 || day > 4) return;
      const currentTime = now.getHours() * 60 + now.getMinutes();
      const currentSlot = slots.find(s =>
        s.memberId === profile.uid && s.day === day &&
        ((currentTime >= 540 && currentTime < 705 && s.shift === 'morning') ||
          (currentTime >= 795 && currentTime < 1095 && s.shift === 'afternoon'))
      );
      if (currentSlot && Notification.permission === 'granted') {
        const project = projects.find(p => p.id === currentSlot.projectId);
        if (project) {
          const key = `notified_${currentSlot.id}`;
          if (localStorage.getItem(key) !== now.toDateString()) {
            new Notification(`Time for ${project.name}!`, {
              body: `Your ${currentSlot.shift} slot has started.`,
              icon: '/favicon.ico'
            });
            localStorage.setItem(key, now.toDateString());
          }
        }
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [profile, teamRole, slots, projects, team]);

  const isLeader = teamRole === 'leader';

  const appValue = useMemo(() => ({
    user, profile, loading, team, teamRole, isLeader
  }), [user, profile, loading, team, teamRole, isLeader]);

  const handleTeamJoined = useCallback(() => {
    // Show loading spinner while onSnapshot picks up the new currentTeamId
    setLoading(true);
    setNeedsTeam(false);
  }, []);

  // Loading
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-4">
          <div className="w-12 h-12 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
          <p className="text-slate-500 font-medium">Đang tải...</p>
        </div>
      </div>
    );
  }

  // Not logged in
  if (!user) return <LoginScreen />;

  // No teams at all (first time user) → show fullscreen onboarding
  if ((needsTeam || !team) && userTeamIds.length === 0) {
    if (!profile) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-slate-50">
          <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
        </div>
      );
    }
    return <TeamOnboarding profile={profile} onTeamJoined={handleTeamJoined} />;
  }

  // Has teams but currentTeam not loaded yet → spinner while auto-switching
  if (!team) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  // Profile not yet loaded
  if (!profile) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
      </div>
    );
  }

  return (
    <ToastProvider>
      <AppContext.Provider value={appValue}>
        <div className="min-h-screen bg-[#F8F9FA] text-gray-900 font-sans">
          {/* Header */}
          <header className="bg-white border-b border-gray-100 sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
              {/* Left: Team Switcher (switch between teams) */}
              <TeamSwitcher
                currentTeam={team}
                userTeamIds={userTeamIds}
                userId={profile.uid}
              />

              <div className="flex items-center gap-2">
                {Notification.permission !== 'granted' && (
                  <button
                    onClick={() => Notification.requestPermission()}
                    className="p-2 text-slate-500 hover:text-blue-600 transition-colors rounded-lg hover:bg-blue-50"
                    title="Bật thông báo"
                  >
                    <Bell className="w-4 h-4" />
                  </button>
                )}
                <SettingsMenu
                  onCreateTeam={() => { setTeamModalMode('create'); setShowTeamModal(true); }}
                  onJoinTeam={() => { setTeamModalMode('join'); setShowTeamModal(true); }}
                />
                <div className="flex items-center gap-2 pl-2 border-l border-gray-100">
                  <div className="w-8 h-8 rounded-full bg-blue-200 flex items-center justify-center text-blue-600 font-bold text-sm">
                    {profile.displayName?.[0] || 'U'}
                  </div>
                  <div className="hidden sm:block">
                    <p className="text-sm font-bold text-slate-900 leading-tight">{profile.displayName}</p>
                    <p className="text-[11px] text-blue-600 font-bold uppercase">{teamRole}</p>
                  </div>
                  <button
                    onClick={() => auth.signOut()}
                    className="ml-1 p-2 rounded-lg text-slate-500 hover:bg-red-50 hover:text-red-500 transition-all"
                    title="Đăng xuất"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          </header>

          <main className="max-w-7xl mx-auto px-6 py-8">
            {isLeader ? (
              <LeaderDashboard
                team={team}
                projects={projects}
                members={teamMembers}
                slots={slots}
                currentMonth={currentMonth}
                setCurrentMonth={setCurrentMonth}
                profile={profile}
              />
            ) : (
              <MemberDashboard
                projects={projects}
                slots={slots}
                currentMonth={currentMonth}
                setCurrentMonth={setCurrentMonth}
                profile={profile}
                team={team}
                teamMembers={teamMembers}
              />
            )}
          </main>
        </div>

        {/* Add team modal */}
        <AnimatePresence>
          {showTeamModal && (
            <TeamOnboarding
              profile={profile}
              isModal
              defaultMode={teamModalMode}
              onClose={() => setShowTeamModal(false)}
              onTeamJoined={() => {
                setShowTeamModal(false);
                setLoading(true);
              }}
            />
          )}
        </AnimatePresence>
      </AppContext.Provider>
    </ToastProvider>
  );
}

// --- Team Switcher Dropdown (only shown when user has multiple teams) ---
function TeamSwitcher({
  currentTeam,
  userTeamIds,
  userId,
}: {
  currentTeam: Team;
  userTeamIds: string[];
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [teams, setTeams] = useState<Team[]>([]);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const hasMultipleTeams = userTeamIds.length > 1;

  // Reset switching state once the parent has loaded the new team
  useEffect(() => {
    setSwitching(false);
  }, [currentTeam.id]);

  // Load all team names when dropdown opens
  useEffect(() => {
    if (!open || !hasMultipleTeams) return;
    const fetchTeams = async () => {
      const docs = await Promise.all(
        userTeamIds.map(id => getDoc(doc(db, 'teams', id)))
      );
      setTeams(docs.filter(d => d.exists()).map(d => d.data() as Team));
    };
    fetchTeams();
  }, [open, userTeamIds, hasMultipleTeams]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleSwitch = async (teamId: string) => {
    if (teamId === currentTeam.id || switching) return;
    setSwitching(true);
    setOpen(false);
    try {
      await setDoc(doc(db, 'users', userId), { currentTeamId: teamId }, { merge: true });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `users/${userId}`);
      setSwitching(false);
    }
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => hasMultipleTeams && setOpen(v => !v)}
        className={cn(
          "flex items-center gap-2 rounded-xl px-3 py-2 transition-all",
          hasMultipleTeams && "hover:bg-slate-100 active:scale-95 cursor-pointer",
          !hasMultipleTeams && "cursor-default",
          open && "bg-slate-100"
        )}
      >
        <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Calendar className="w-4 h-4 text-white" />
        </div>
        <div className="text-left">
          <div className="flex items-center gap-1">
            <h1 className="text-sm font-black tracking-tight text-slate-900 leading-tight">
              {switching ? 'Đang chuyển...' : currentTeam.name}
            </h1>
            {hasMultipleTeams && (
              <ChevronDown className={cn("w-3.5 h-3.5 text-slate-400 transition-transform", open && "rotate-180")} />
            )}
          </div>
          <p className="text-[10px] uppercase tracking-widest text-slate-500 font-bold leading-tight">Team Scheduler</p>
        </div>
      </button>

      <AnimatePresence>
        {open && hasMultipleTeams && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-2 w-64 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden z-50"
          >
            <div className="p-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-2 py-1.5">Chuyển team</p>
              {teams.map(t => (
                <button
                  key={t.id}
                  onClick={() => handleSwitch(t.id)}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left transition-all",
                    t.id === currentTeam.id
                      ? "bg-blue-50 text-blue-700"
                      : "hover:bg-slate-50 text-slate-700"
                  )}
                >
                  <div className={cn(
                    "w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black flex-shrink-0",
                    t.id === currentTeam.id ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-600"
                  )}>
                    {t.name[0].toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-bold truncate">{t.name}</p>
                  </div>
                  {t.id === currentTeam.id && (
                    <CheckCircle2 className="w-4 h-4 text-blue-600 flex-shrink-0" />
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Settings Menu (create/join team) ---
function SettingsMenu({
  onCreateTeam,
  onJoinTeam,
}: {
  onCreateTeam: () => void;
  onJoinTeam: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className={cn(
          "p-2 rounded-lg text-slate-500 hover:text-slate-700 hover:bg-slate-100 transition-all",
          open && "bg-slate-100 text-slate-700"
        )}
        title="Cài đặt"
      >
        <Settings className="w-4 h-4" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -8, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.97 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full right-0 mt-2 w-52 bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden z-50"
          >
            <div className="p-2">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-2 py-1.5">Team</p>
              <button
                onClick={() => { setOpen(false); onCreateTeam(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-50 transition-all text-slate-700"
              >
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center flex-shrink-0">
                  <Plus className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <p className="text-sm font-bold">Tạo team mới</p>
              </button>
              <button
                onClick={() => { setOpen(false); onJoinTeam(); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left hover:bg-slate-50 transition-all text-slate-700"
              >
                <div className="w-7 h-7 rounded-lg bg-emerald-50 flex items-center justify-center flex-shrink-0">
                  <LogIn className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <p className="text-sm font-bold">Join team</p>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Leader Dashboard ---
function LeaderDashboard({ team, projects, members, slots, currentMonth, setCurrentMonth, profile }: {
  team: Team;
  projects: Project[];
  members: TeamMember[];
  slots: Slot[];
  currentMonth: Date;
  setCurrentMonth: (d: Date) => void;
  profile: UserProfile;
}) {
  const [activeTab, setActiveTab] = useState<'schedule' | 'projects' | 'team'>('schedule');
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const [selectedDay, setSelectedDay] = useState<Date | null>(null);
  // Default to self (leader), can switch to any member
  const [viewingMemberId, setViewingMemberId] = useState<string>(profile.uid);
  const teamMembers = members.filter(m => m.role === 'member');
  // All selectable people: self + team members
  const selectableMembers = useMemo(() => {
    const self: TeamMember = { uid: profile.uid, email: profile.email, displayName: profile.displayName, role: 'leader', joinedAt: '' };
    const others = teamMembers.filter(m => m.uid !== profile.uid);
    return [self, ...others];
  }, [profile, teamMembers]);
  const viewingMember = selectableMembers.find(m => m.uid === viewingMemberId) ?? selectableMembers[0];

  const displayMonth = `Tháng ${format(currentMonth, 'M')}, ${format(currentMonth, 'yyyy')}`;

  const handleAddProject = async (name: string) => {
    const id = Date.now().toString();
    try {
      await setDoc(doc(db, 'projects', id), { id, name, teamId: team.id });
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `projects/${id}`);
    }
  };

  const handleDeleteProject = async (id: string) => {
    try {
      await deleteDoc(doc(db, 'projects', id));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `projects/${id}`);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!window.confirm('Are you sure you want to remove this member? All their data will be deleted.')) return;

    // Step 1: Remove from team — this is the critical step, must succeed
    try {
      await deleteDoc(doc(db, 'teams', team.id, 'members', memberId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, `teams/${team.id}/members/${memberId}`);
      return;
    }

    // Step 2: Update member's user doc (best-effort — don't block on failure)
    try {
      const userDocRef = doc(db, 'users', memberId);
      const userSnap = await getDoc(userDocRef);
      const userData = userSnap.data() as (UserProfile & { currentTeamId?: string; teamIds?: string[] }) | undefined;
      const remainingTeamIds = (userData?.teamIds ?? []).filter(id => id !== team.id);
      const isViewingThisTeam = userData?.currentTeamId === team.id;
      await setDoc(userDocRef, {
        teamIds: arrayRemove(team.id),
        ...(isViewingThisTeam && {
          currentTeamId: remainingTeamIds.length > 0 ? remainingTeamIds[0] : null,
        }),
      }, { merge: true });
    } catch { /* best-effort: member's onSnapshot will self-heal via stale-id cleanup */ }

    // Step 3: Clear all slots for this member in this team (best-effort)
    try {
      const q = query(
        collection(db, 'slots'),
        where('teamId', '==', team.id),
        where('memberId', '==', memberId)
      );
      const snap = await getDocs(q);
      await Promise.all(snap.docs.map(d => deleteDoc(d.ref)));
    } catch { /* best-effort */ }
  };

  return (
    <div className="space-y-6">
      {/* Month nav + view toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentMonth(startOfMonth(new Date()))}
            className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-all bg-white shadow-sm active:scale-95"
          >
            Hôm nay
          </button>
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
            <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-colors active:scale-95">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-sm font-black text-slate-800 w-[140px] text-center uppercase tracking-widest">{displayMonth}</h2>
            <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-colors active:scale-95">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
          <button
            onClick={() => setViewMode('calendar')}
            className={cn("p-2 rounded-lg transition-all", viewMode === 'calendar' ? "bg-slate-900 text-white shadow-md" : "text-slate-500 hover:text-slate-900")}
            title="Calendar View"
          >
            <Grid3X3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn("p-2 rounded-lg transition-all", viewMode === 'list' ? "bg-slate-900 text-white shadow-md" : "text-slate-500 hover:text-slate-900")}
            title="List View"
          >
            <ListIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex bg-white p-1.5 rounded-2xl border border-slate-200 shadow-sm w-fit">
        {(['schedule', 'projects', 'team'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "px-6 py-2.5 rounded-xl text-sm font-bold transition-all duration-200",
              activeTab === tab ? "bg-slate-900 text-white shadow-lg" : "text-slate-500 hover:text-slate-900 hover:bg-slate-50"
            )}
          >
            {tab === 'schedule' ? 'Lịch trình' : tab === 'projects' ? 'Dự án' : 'Team'}
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        {activeTab === 'schedule' && (
          <motion.div key="schedule" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="space-y-4">
            {/* Member picker */}
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Xem lịch của:</span>
              <div className="flex items-center gap-2 flex-wrap">
                {selectableMembers.map((m, i) => {
                  const isMe = m.uid === profile.uid;
                  const color = getMemberColor(i);
                  const isSelected = viewingMemberId === m.uid;
                  return (
                    <button
                      key={m.uid}
                      onClick={() => setViewingMemberId(m.uid)}
                      className={cn(
                        "flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold border transition-all",
                        isSelected
                          ? "bg-blue-600 text-white border-transparent shadow-md"
                          : "bg-white border-slate-200 text-slate-600 hover:border-blue-200 hover:bg-slate-50"
                      )}
                    >
                      <div className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black text-white",
                        color.bg, isSelected && "ring-1 ring-white/50"
                      )}>
                        {m.displayName[0]}
                      </div>
                      {m.displayName}{isMe && ' (tôi)'}
                    </button>
                  );
                })}
              </div>
            </div>

            {viewMode === 'calendar' ? (
              <MonthlyCalendar
                currentMonth={currentMonth}
                slots={slots}
                members={members}
                projects={projects}
                isLeader={false}
                profile={{ uid: viewingMemberId, email: viewingMember?.email ?? '', displayName: viewingMember?.displayName ?? '' }}
                onDayClick={setSelectedDay}
              />
            ) : (
              <div className="bg-white rounded-[32px] p-8 overflow-hidden border border-slate-200 shadow-xl shadow-slate-200/50">
                <TimeSlotGrid
                  projects={projects}
                  members={[viewingMember].filter(Boolean) as TeamMember[]}
                  allMembers={members}
                  slots={slots}
                  currentMonth={currentMonth}
                  teamId={team.id}
                />
              </div>
            )}

            <AnimatePresence>
              {selectedDay && (
                <DayTimelineModal
                  date={selectedDay}
                  slots={slots}
                  members={members}
                  projects={projects}
                  teamId={team.id}
                  preselectedMemberId={viewingMemberId}
                  onClose={() => setSelectedDay(null)}
                />
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {activeTab === 'projects' && (
          <motion.div key="projects" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="bg-white rounded-[32px] shadow-xl shadow-slate-200/50 border border-slate-200 p-8"
          >
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight">Dự án</h2>
                <p className="text-slate-500 font-medium mt-1 text-sm">Danh sách dự án của team.</p>
              </div>
              <button
                onClick={() => {
                  const name = prompt('Tên dự án mới:');
                  if (name) handleAddProject(name);
                }}
                className="bg-slate-900 text-white px-6 py-2.5 rounded-2xl font-bold flex items-center gap-2 hover:bg-slate-800 transition-all shadow-lg shadow-slate-200"
              >
                <Plus className="w-4 h-4" /> Thêm dự án
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {projects.length === 0 ? (
                <div className="col-span-3 py-16 text-center text-slate-400">
                  <Briefcase className="w-10 h-10 mx-auto mb-3 opacity-70" />
                  <p className="font-medium">Chưa có dự án nào.</p>
                </div>
              ) : projects.map(p => (
                <motion.div layout key={p.id}
                  className="group bg-slate-200/50 border border-slate-200 p-5 rounded-[20px] flex items-center justify-between hover:bg-white hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-300"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm border border-slate-200">
                      <Briefcase className="w-5 h-5 text-slate-500" />
                    </div>
                    <span className="font-bold text-slate-800">{p.name}</span>
                  </div>
                  <button
                    onClick={() => handleDeleteProject(p.id)}
                    className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'team' && (
          <motion.div key="team" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {/* Invite Card */}
            <div className="bg-white rounded-[32px] border border-slate-200 shadow-xl p-8">
              <div className="flex items-center gap-3 mb-6">
                <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center">
                  <UserPlus className="w-5 h-5 text-blue-600" />
                </div>
                <h3 className="font-black text-slate-900">Mời thành viên</h3>
              </div>
              <p className="text-sm text-slate-500 mb-4">Chia sẻ invite code này để member join team.</p>
              <div className="bg-slate-50 rounded-2xl p-4 flex items-center justify-between border border-slate-200">
                <span className="text-2xl font-black tracking-[0.3em] text-slate-900 font-mono">{team.inviteCode}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(team.inviteCode)}
                  className="p-2 text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                  title="Copy invite code"
                >
                  <Copy className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Members List */}
            <div className="md:col-span-2 bg-white rounded-[32px] border border-slate-200 shadow-xl overflow-hidden">
              <div className="p-6 border-b border-slate-200 flex items-center gap-2">
                <Users className="w-4 h-4 text-slate-500" />
                <span className="text-xs font-bold uppercase tracking-widest text-slate-500">Thành viên ({members.length})</span>
              </div>
              <div className="divide-y divide-slate-50">
                {members.map(m => (
                  <div key={m.uid} className="p-5 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-blue-200 flex items-center justify-center text-blue-600 font-bold">
                        {m.displayName?.[0] || 'U'}
                      </div>
                      <div>
                        <p className="font-bold text-slate-900 text-sm">{m.displayName}</p>
                        <p className="text-xs text-slate-500">{m.email}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold uppercase",
                        m.role === 'leader' ? "bg-blue-50 text-blue-600" : "bg-slate-200 text-slate-500"
                      )}>
                        {m.role === 'leader' && <Shield className="w-3 h-3" />}
                        {m.role}
                      </div>

                      {m.role !== 'leader' && (
                        <button
                          onClick={() => handleRemoveMember(m.uid)}
                          className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-50 rounded-xl transition-all"
                          title="Remove member"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// --- Time Slot Grid (List view) ---
function TimeSlotGrid({ projects, members, allMembers, slots, currentMonth, teamId }: {
  projects: Project[];
  members: TeamMember[];
  allMembers: TeamMember[];
  slots: Slot[];
  currentMonth: Date;
  teamId: string;
}) {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const workDays = eachDayOfInterval({ start: monthStart, end: monthEnd })
    .filter(d => { const day = getDay(d); return day >= 1 && day <= 4; });

  const weeks: { [key: string]: Date[] } = {};
  workDays.forEach(date => {
    const ws = startOfWeek(date, { weekStartsOn: 1 }).toISOString();
    if (!weeks[ws]) weeks[ws] = [];
    weeks[ws].push(date);
  });

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-slate-200/50">
            <th className="p-5 text-left border-b border-slate-200 min-w-[180px] sticky left-0 bg-slate-50 z-20">
              <div className="flex items-center gap-2 text-slate-500">
                <Users className="w-4 h-4" />
                <span className="text-xs font-bold uppercase tracking-widest">Member</span>
              </div>
            </th>
            {Object.entries(weeks).map(([ws, days]) => (
              <th key={ws} colSpan={days.length} className="p-3 text-center border-b border-l border-slate-200 bg-slate-50/80">
                <p className="text-[11px] font-bold text-slate-500 uppercase tracking-widest">Week of</p>
                <p className="text-xs font-black text-slate-900">{format(new Date(ws), 'MMM dd, yyyy')}</p>
              </th>
            ))}
          </tr>
          <tr className="bg-slate-50/30">
            <th className="border-b border-slate-200 sticky left-0 bg-slate-50 z-20"></th>
            {workDays.map(date => (
              <th key={date.toISOString()} className="p-3 text-center border-b border-l border-slate-200 min-w-[120px]">
                <p className="text-xs font-bold text-slate-900">{format(date, 'EEE')}</p>
                <p className="text-[11px] text-slate-500 font-medium">{format(date, 'MMM dd')}</p>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {members.map((member) => {
            const mi = allMembers ? allMembers.findIndex(m => m.uid === member.uid) + 1 : 0;
            const color = getMemberColor(mi);
            return (
              <tr key={member.uid} className="hover:bg-slate-200/50 transition-colors">
                <td className="p-4 border-b border-slate-200 sticky left-0 bg-white z-10">
                  <div className="flex items-center gap-2">
                    <div className={cn("w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-black text-white flex-shrink-0", color.bg)}>
                      {member.displayName?.[0] || 'U'}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{member.displayName}</p>
                      <p className="text-xs text-slate-500">{member.email}</p>
                    </div>
                  </div>
                </td>
                {workDays.map(date => {
                  const weekStart = startOfWeek(date, { weekStartsOn: 1 });
                  const dayIndex = getDay(date);
                  const daySlots = slots.filter(s =>
                    s.memberId === member.uid && s.day === dayIndex && s.weekStart === weekStart.toISOString()
                  );
                  return (
                    <td key={date.toISOString()} className="p-2 border-b border-l border-slate-200 align-top">
                      <div className="flex flex-col gap-1 min-h-[40px]">
                        {daySlots.length === 0 ? (
                          <div className="flex flex-col items-center justify-center h-[46px] gap-1 opacity-70 mt-1">
                            <Coffee className="w-4 h-4 text-rose-300" />
                            <span className="text-[9px] font-black uppercase text-rose-300 tracking-widest leading-none">Free</span>
                          </div>
                        ) : daySlots.map(slot => {
                          const project = projects.find(p => p.id === slot.projectId);
                          return <SlotPill key={slot.id} slot={slot} project={project} color={color} />;
                        })}
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Member Dashboard ---
function MemberDashboard({ projects, slots, currentMonth, setCurrentMonth, profile, team, teamMembers }: {
  projects: Project[];
  slots: Slot[];
  currentMonth: Date;
  setCurrentMonth: (d: Date) => void;
  profile: UserProfile;
  team: Team;
  teamMembers: TeamMember[];
}) {
  const leader = teamMembers.find(m => m.role === 'leader');
  const [viewMode, setViewMode] = useState<'calendar' | 'list'>('calendar');
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const workDays = eachDayOfInterval({ start: monthStart, end: monthEnd })
    .filter(d => { const day = getDay(d); return day >= 1 && day <= 4; });

  const mySlots = slots.filter(s => s.memberId === profile.uid);
  const displayMonth = `Tháng ${format(currentMonth, 'M')}, ${format(currentMonth, 'yyyy')}`;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setCurrentMonth(startOfMonth(new Date()))}
            className="px-4 py-2 border border-slate-200 rounded-xl text-sm font-bold text-slate-700 hover:text-slate-900 hover:bg-slate-50 transition-all bg-white shadow-sm active:scale-95"
          >
            Hôm nay
          </button>
          <div className="flex items-center bg-white border border-slate-200 rounded-xl p-1 shadow-sm">
            <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-colors active:scale-95">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <h2 className="text-sm font-black text-slate-800 w-[140px] text-center uppercase tracking-widest">{displayMonth}</h2>
            <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="p-1.5 hover:bg-slate-100 rounded-lg text-slate-500 hover:text-slate-900 transition-colors active:scale-95">
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex bg-white p-1 rounded-xl border border-slate-200 shadow-sm">
          <button
            onClick={() => setViewMode('calendar')}
            className={cn("p-2 rounded-lg transition-all", viewMode === 'calendar' ? "bg-slate-900 text-white shadow-md" : "text-slate-500 hover:text-slate-900")}
          >
            <Grid3X3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn("p-2 rounded-lg transition-all", viewMode === 'list' ? "bg-slate-900 text-white shadow-md" : "text-slate-500 hover:text-slate-900")}
          >
            <ListIcon className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-slate-900 tracking-tight">
            My <span className="text-blue-600">Schedule</span>
          </h1>
          <p className="text-slate-500 font-medium mt-1 text-sm">Lịch phân công dự án của bạn trong tháng này.</p>
        </div>

        {/* Leader info chip */}
        {leader && (
          <div className="flex items-center gap-2.5 px-4 py-2.5 bg-white border border-slate-200 rounded-2xl shadow-sm shrink-0">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-black shrink-0">
              {leader.displayName[0]}
            </div>
            <div className="leading-tight">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Leader · {team.name}</p>
              <p className="text-sm font-black text-slate-900">{leader.displayName}</p>
            </div>
            <Shield className="w-3.5 h-3.5 text-blue-500 shrink-0 ml-1" />
          </div>
        )}
      </div>

      {viewMode === 'calendar' ? (
        <MonthlyCalendar
          currentMonth={currentMonth}
          slots={slots}
          members={[]}
          projects={projects}
          isLeader={false}
          profile={profile}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {workDays.map((date, i) => {
            const isToday = isSameDay(new Date(), date);

            return (
              <motion.div
                key={date.toISOString()}
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: i * 0.02 }}
                className={cn(
                  "bg-white rounded-[24px] p-5 flex flex-col gap-4 transition-all hover:shadow-xl hover:shadow-slate-200 hover:-translate-y-0.5",
                  isToday ? "ring-2 ring-blue-500 shadow-blue-100 shadow-xl" : "border border-slate-200"
                )}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <p className={cn("text-base font-black tracking-tight", isToday ? "text-blue-600" : "text-slate-900")}>{format(date, 'EEEE')}</p>
                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest">{format(date, 'MMM dd')}</p>
                  </div>
                  {isToday && <div className="bg-blue-600 text-white text-[11px] font-black px-2.5 py-1 rounded-full uppercase tracking-widest">Today</div>}
                </div>

                <div className="space-y-2">
                  {(() => {
                    const weekStart = startOfWeek(date, { weekStartsOn: 1 });
                    const dayIndex = getDay(date);
                    const daySlots = mySlots.filter(s => s.day === dayIndex && s.weekStart === weekStart.toISOString());
                    if (daySlots.length === 0) {
                      return (
                        <div className="p-4 rounded-xl flex items-center justify-center gap-1.5 text-rose-300 min-h-[80px]">
                          <Coffee className="w-4 h-4 opacity-70" />
                          <span className="text-[11px] font-black uppercase tracking-widest leading-none">Free Day</span>
                        </div>
                      );
                    }
                    return daySlots.map(slot => {
                      const project = projects.find(p => p.id === slot.projectId);
                      const { start, end } = getSlotHours(slot);
                      return (
                        <div key={slot.id} className="bg-slate-900 text-white p-3 rounded-xl shadow-md">
                          <div className="flex items-center gap-1.5 mb-1">
                            <Clock className="FFw-3 h-3 opacity-70" />
                            <span className="text-[11px] font-bold opacity-70 uppercase tracking-widest">
                              {slot.type === 'half-day' ? (slot.shift === 'morning' ? 'Sáng' : 'Chiều') : 'Custom'} · {fmtHour(start)}–{fmtHour(end)}
                            </span>
                          </div>
                          <p className="text-xs font-bold truncate">{project?.name ?? 'Booked'}</p>
                        </div>
                      );
                    });
                  })()}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}
    </div>
  );
}
