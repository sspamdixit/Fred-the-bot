import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SiDiscord } from "react-icons/si";
import {
  Server,
  Clock,
  Activity,
  Eye,
  Wifi,
  WifiOff,
  AlertCircle,
  RefreshCw,
  Send,
  Hash,
  CheckCircle2,
  Megaphone,
} from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface BotStatus {
  online: boolean;
  tag: string | null;
  avatarUrl: string | null;
  guildCount: number;
  uptimeStart: number | null;
  status: string;
  activityName: string;
  activityType: string;
  lastError: string | null;
}

interface ChannelInfo {
  id: string;
  name: string;
  type: string;
}

interface GuildInfo {
  id: string;
  name: string;
  iconUrl: string | null;
  channels: ChannelInfo[];
}

function formatUptime(uptimeStart: number | null): string {
  if (!uptimeStart) return "—";
  const ms = Date.now() - uptimeStart;
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
  if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function StatusDot({ status }: { status: string }) {
  if (status === "online")
    return <span data-testid="status-dot-online" className="inline-block w-3 h-3 rounded-full bg-status-online pulse-dot" />;
  if (status === "error")
    return <span data-testid="status-dot-error" className="inline-block w-3 h-3 rounded-full bg-status-busy pulse-dot-error" />;
  return <span data-testid="status-dot-offline" className="inline-block w-3 h-3 rounded-full bg-status-offline" />;
}

export default function Home() {
  const { toast } = useToast();
  const [selectedGuildId, setSelectedGuildId] = useState<string>("");
  const [selectedChannelId, setSelectedChannelId] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [lastSent, setLastSent] = useState<{ channel: string; guild: string } | null>(null);

  const { data: status, isLoading: statusLoading, isError, refetch, isFetching } = useQuery<BotStatus>({
    queryKey: ["/api/bot/status"],
    refetchInterval: 5000,
  });

  const { data: guilds = [], isLoading: guildsLoading } = useQuery<GuildInfo[]>({
    queryKey: ["/api/bot/guilds"],
    refetchInterval: 30000,
    enabled: status?.online === true,
  });

  const selectedGuild = guilds.find((g) => g.id === selectedGuildId);
  const selectedChannel = selectedGuild?.channels.find((c) => c.id === selectedChannelId);

  useEffect(() => {
    if (guilds.length > 0 && !selectedGuildId) {
      setSelectedGuildId(guilds[0].id);
    }
  }, [guilds]);

  useEffect(() => {
    if (selectedGuild && selectedGuild.channels.length > 0) {
      setSelectedChannelId(selectedGuild.channels[0].id);
    } else {
      setSelectedChannelId("");
    }
  }, [selectedGuildId]);

  const sendMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("POST", "/api/bot/send", {
        channelId: selectedChannelId,
        content: message,
      });
    },
    onSuccess: () => {
      setLastSent({
        channel: selectedChannel?.name ?? selectedChannelId,
        guild: selectedGuild?.name ?? selectedGuildId,
      });
      setMessage("");
      toast({
        title: "Message sent",
        description: `Posted to #${selectedChannel?.name} in ${selectedGuild?.name}`,
      });
    },
    onError: (err: any) => {
      toast({
        title: "Failed to send",
        description: err?.message ?? "Something went wrong.",
        variant: "destructive",
      });
    },
  });

  const statusLabel = status?.status === "online" ? "Online" : status?.status === "error" ? "Error" : "Offline";
  const statusColor = status?.status === "online" ? "text-status-online" : status?.status === "error" ? "text-status-busy" : "text-status-offline";
  const canSend = status?.online && selectedChannelId && message.trim().length > 0 && !sendMutation.isPending;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-6">

        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-md bg-primary/20 flex items-center justify-center">
              <SiDiscord className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground" data-testid="text-title">
                Bubbl Manager
              </h1>
              <p className="text-sm text-muted-foreground">Bot Control Panel</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => refetch()} disabled={isFetching} data-testid="button-refresh">
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Bot Identity Card */}
        <Card className="border-card-border bg-card">
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center gap-5">
              <div className="relative flex-shrink-0">
                {statusLoading ? (
                  <Skeleton className="w-20 h-20 rounded-full" />
                ) : status?.avatarUrl ? (
                  <img src={status.avatarUrl} alt="Bot avatar" data-testid="img-avatar" className="w-20 h-20 rounded-full border-2 border-primary/30 object-cover" />
                ) : (
                  <div className="w-20 h-20 rounded-full border-2 border-border bg-muted flex items-center justify-center">
                    <SiDiscord className="w-9 h-9 text-muted-foreground" />
                  </div>
                )}
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-card border-2 border-card flex items-center justify-center">
                  {!statusLoading && <StatusDot status={status?.status ?? "offline"} />}
                </div>
              </div>

              <div className="flex-1 min-w-0 space-y-1">
                {statusLoading ? (
                  <>
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-lg font-semibold text-foreground truncate" data-testid="text-bot-tag">
                        {status?.tag ?? "Not connected"}
                      </h2>
                      <Badge variant="secondary" data-testid="badge-status" className={`text-xs font-medium ${statusColor}`}>
                        {statusLabel}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Eye className="w-3.5 h-3.5 flex-shrink-0" />
                      <span data-testid="text-activity">
                        {status?.online ? `${status.activityType} ${status.activityName}` : "No activity"}
                      </span>
                    </div>
                  </>
                )}
              </div>

              <div className="flex-shrink-0">
                {statusLoading ? (
                  <Skeleton className="w-10 h-10 rounded-md" />
                ) : status?.online ? (
                  <div className="w-10 h-10 rounded-md bg-status-online/10 flex items-center justify-center">
                    <Wifi className="w-5 h-5 text-status-online" />
                  </div>
                ) : (
                  <div className="w-10 h-10 rounded-md bg-status-offline/10 flex items-center justify-center">
                    <WifiOff className="w-5 h-5 text-status-offline" />
                  </div>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Card className="border-card-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Status</CardTitle>
              <Activity className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              {statusLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="flex items-center gap-2">
                  <StatusDot status={status?.status ?? "offline"} />
                  <span className={`text-2xl font-bold ${statusColor}`} data-testid="text-status-value">{statusLabel}</span>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-card-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Servers</CardTitle>
              <Server className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              {statusLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span className="text-2xl font-bold text-foreground" data-testid="text-guild-count">
                  {status?.guildCount ?? 0}
                </span>
              )}
            </CardContent>
          </Card>

          <Card className="border-card-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">Uptime</CardTitle>
              <Clock className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              {statusLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <span className="text-2xl font-bold text-foreground" data-testid="text-uptime">
                  {formatUptime(status?.uptimeStart ?? null)}
                </span>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Message Composer */}
        <Card className="border-card-border bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold text-foreground flex items-center gap-2">
              <Send className="w-4 h-4 text-primary" />
              Send a Message
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {!status?.online && !statusLoading && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-muted/40 text-sm text-muted-foreground">
                <WifiOff className="w-4 h-4 flex-shrink-0" />
                <span>Bot must be online to send messages.</span>
              </div>
            )}

            {status?.online && (
              <>
                {/* Server + Channel selectors */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Server */}
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground" htmlFor="select-server">
                      Server
                    </Label>
                    {guildsLoading ? (
                      <Skeleton className="h-9 w-full" />
                    ) : (
                      <Select
                        value={selectedGuildId}
                        onValueChange={(v) => setSelectedGuildId(v)}
                      >
                        <SelectTrigger data-testid="select-server" id="select-server" className="w-full">
                          <SelectValue placeholder="Select a server…" />
                        </SelectTrigger>
                        <SelectContent>
                          {guilds.length === 0 ? (
                            <SelectItem value="__none" disabled>No servers found</SelectItem>
                          ) : (
                            guilds.map((g) => (
                              <SelectItem key={g.id} value={g.id} data-testid={`option-server-${g.id}`}>
                                <div className="flex items-center gap-2">
                                  {g.iconUrl ? (
                                    <img src={g.iconUrl} alt={g.name} className="w-4 h-4 rounded-full object-cover" />
                                  ) : (
                                    <div className="w-4 h-4 rounded-full bg-muted flex items-center justify-center">
                                      <SiDiscord className="w-2.5 h-2.5 text-muted-foreground" />
                                    </div>
                                  )}
                                  <span>{g.name}</span>
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>

                  {/* Channel */}
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground" htmlFor="select-channel">
                      Channel
                    </Label>
                    {guildsLoading ? (
                      <Skeleton className="h-9 w-full" />
                    ) : (
                      <Select
                        value={selectedChannelId}
                        onValueChange={(v) => setSelectedChannelId(v)}
                        disabled={!selectedGuildId || (selectedGuild?.channels.length ?? 0) === 0}
                      >
                        <SelectTrigger data-testid="select-channel" id="select-channel" className="w-full">
                          <SelectValue placeholder="Select a channel…" />
                        </SelectTrigger>
                        <SelectContent>
                          {(selectedGuild?.channels ?? []).length === 0 ? (
                            <SelectItem value="__none" disabled>No text channels</SelectItem>
                          ) : (
                            (selectedGuild?.channels ?? []).map((ch) => (
                              <SelectItem key={ch.id} value={ch.id} data-testid={`option-channel-${ch.id}`}>
                                <div className="flex items-center gap-2">
                                  {ch.type === "announcement" ? (
                                    <Megaphone className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                  ) : (
                                    <Hash className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                  )}
                                  <span>{ch.name}</span>
                                </div>
                              </SelectItem>
                            ))
                          )}
                        </SelectContent>
                      </Select>
                    )}
                  </div>
                </div>

                {/* Message input */}
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm text-muted-foreground" htmlFor="input-message">
                      Message
                    </Label>
                    <span className={`text-xs ${message.length > 1900 ? "text-status-busy" : "text-muted-foreground"}`}>
                      {message.length}/2000
                    </span>
                  </div>
                  <Textarea
                    id="input-message"
                    data-testid="input-message"
                    placeholder={selectedChannelId ? `Message #${selectedChannel?.name ?? "channel"}` : "Select a channel first…"}
                    value={message}
                    onChange={(e) => setMessage(e.target.value.slice(0, 2000))}
                    disabled={!selectedChannelId}
                    rows={4}
                    className="resize-none text-sm"
                  />
                </div>

                {/* Send button + last sent */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  {lastSent ? (
                    <div className="flex items-center gap-1.5 text-xs text-status-online">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      <span data-testid="text-last-sent">
                        Sent to #{lastSent.channel} in {lastSent.guild}
                      </span>
                    </div>
                  ) : (
                    <span />
                  )}
                  <Button
                    data-testid="button-send"
                    onClick={() => sendMutation.mutate()}
                    disabled={!canSend}
                  >
                    {sendMutation.isPending ? (
                      <>
                        <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Send className="w-4 h-4 mr-2" />
                        Send Message
                      </>
                    )}
                  </Button>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Error panel */}
        {!statusLoading && (isError || status?.lastError) && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Connection error</p>
                <p className="text-sm text-muted-foreground" data-testid="text-error-message">
                  {status?.lastError ?? "Could not reach the bot. Check that your TOKEN is valid."}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        <p className="text-center text-xs text-muted-foreground" data-testid="text-footer">
          Status refreshes automatically every 5 seconds
        </p>
      </div>
    </div>
  );
}
