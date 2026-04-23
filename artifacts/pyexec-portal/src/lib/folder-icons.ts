import {
  Folder, FolderOpen, Briefcase, BarChart3, FileText, Database,
  Cog, BookOpen, Mail, Cloud, Lock, Star, Heart, Zap,
  Code2, Server, Package, PieChart, Calendar, Users, Box,
  Layers, Activity, Globe,
} from "lucide-react";

export const FOLDER_ICONS = {
  Folder, FolderOpen, Briefcase, BarChart3, FileText, Database,
  Cog, BookOpen, Mail, Cloud, Lock, Star, Heart, Zap,
  Code2, Server, Package, PieChart, Calendar, Users, Box,
  Layers, Activity, Globe,
} as const;

export type FolderIconName = keyof typeof FOLDER_ICONS;

export const FOLDER_COLORS = [
  { name: "amber",  text: "text-amber-500",  bg: "bg-amber-500/10",  border: "border-amber-500/30" },
  { name: "blue",   text: "text-blue-500",   bg: "bg-blue-500/10",   border: "border-blue-500/30" },
  { name: "green",  text: "text-emerald-500",bg: "bg-emerald-500/10",border: "border-emerald-500/30" },
  { name: "purple", text: "text-purple-500", bg: "bg-purple-500/10", border: "border-purple-500/30" },
  { name: "pink",   text: "text-pink-500",   bg: "bg-pink-500/10",   border: "border-pink-500/30" },
  { name: "red",    text: "text-red-500",    bg: "bg-red-500/10",    border: "border-red-500/30" },
  { name: "slate",  text: "text-slate-500",  bg: "bg-slate-500/10",  border: "border-slate-500/30" },
  { name: "teal",   text: "text-teal-500",   bg: "bg-teal-500/10",   border: "border-teal-500/30" },
  { name: "orange", text: "text-orange-500", bg: "bg-orange-500/10", border: "border-orange-500/30" },
  { name: "indigo", text: "text-indigo-500", bg: "bg-indigo-500/10", border: "border-indigo-500/30" },
] as const;

export type FolderColorName = (typeof FOLDER_COLORS)[number]["name"];

export function getColor(name?: string | null) {
  return FOLDER_COLORS.find(c => c.name === name) ?? FOLDER_COLORS[0];
}

export function getIcon(name?: string | null) {
  return FOLDER_ICONS[(name as FolderIconName) ?? "Folder"] ?? Folder;
}
