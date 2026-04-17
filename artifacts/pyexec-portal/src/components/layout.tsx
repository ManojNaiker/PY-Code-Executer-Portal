import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk } from "@clerk/react";
import { 
  Sidebar, 
  SidebarContent, 
  SidebarGroup, 
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarFooter,
  useSidebar
} from "@/components/ui/sidebar";
import { useGetMyProfile, getGetMyProfileQueryKey } from "@workspace/api-client-react";
import { 
  Code2, 
  LayoutDashboard, 
  Upload, 
  Users, 
  Building2, 
  ShieldAlert,
  LogOut,
  User as UserIcon,
  Menu
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function Layout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  
  const { data: profile } = useGetMyProfile({
    query: {
      enabled: !!user?.id,
      queryKey: getGetMyProfileQueryKey()
    }
  });

  const isAdmin = profile?.role === "admin";

  const navItems = [
    { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
    { title: "Scripts", href: "/scripts", icon: Code2 },
    { title: "Upload Script", href: "/upload", icon: Upload },
  ];

  const adminItems = [
    { title: "Departments", href: "/admin/departments", icon: Building2 },
    { title: "Users", href: "/admin/users", icon: Users },
    { title: "Audit Log", href: "/admin/audit", icon: ShieldAlert },
  ];

  return (
    <SidebarProvider>
      <div className="flex min-h-screen w-full bg-background">
        <Sidebar className="border-r">
          <SidebarHeader className="flex h-14 items-center px-4 font-bold text-lg text-primary tracking-tight">
            <Code2 className="mr-2 h-5 w-5" />
            PyExec Portal
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Platform</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  {navItems.map((item) => (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton asChild isActive={location === item.href}>
                        <Link href={item.href} className="flex items-center">
                          <item.icon className="mr-2 h-4 w-4" />
                          <span>{item.title}</span>
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>

            {isAdmin && (
              <SidebarGroup>
                <SidebarGroupLabel>Administration</SidebarGroupLabel>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {adminItems.map((item) => (
                      <SidebarMenuItem key={item.title}>
                        <SidebarMenuButton asChild isActive={location === item.href}>
                          <Link href={item.href} className="flex items-center">
                            <item.icon className="mr-2 h-4 w-4" />
                            <span>{item.title}</span>
                          </Link>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </SidebarGroup>
            )}
          </SidebarContent>
          <SidebarFooter className="p-4">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="w-full justify-start">
                  <UserIcon className="mr-2 h-4 w-4" />
                  <span className="truncate">{user?.fullName || user?.primaryEmailAddress?.emailAddress}</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuItem disabled>
                  <span className="font-mono text-xs">{profile?.departmentName || 'No Department'}</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => signOut({ redirectUrl: '/' })}>
                  <LogOut className="mr-2 h-4 w-4" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarFooter>
        </Sidebar>
        
        <main className="flex flex-1 flex-col overflow-hidden">
          <header className="flex h-14 items-center gap-4 border-b bg-background px-6 md:hidden">
            <SidebarMobileTrigger />
            <span className="font-bold">PyExec Portal</span>
          </header>
          <div className="flex-1 overflow-y-auto p-6 md:p-8">
            <div className="mx-auto max-w-5xl w-full">
              {children}
            </div>
          </div>
        </main>
      </div>
    </SidebarProvider>
  );
}

function SidebarMobileTrigger() {
  const { toggleSidebar } = useSidebar();
  return (
    <Button variant="ghost" size="icon" onClick={toggleSidebar}>
      <Menu className="h-5 w-5" />
    </Button>
  );
}
