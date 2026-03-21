import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";

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
  if (status === "online") {
    return (
      <span
        data-testid="status-dot-online"
        className="inline-block w-3 h-3 rounded-full bg-status-online pulse-dot"
      />
    );
  }
  if (status === "error") {
    return (
      <span
        data-testid="status-dot-error"
        className="inline-block w-3 h-3 rounded-full bg-status-busy pulse-dot-error"
      />
    );
  }
  return (
    <span
      data-testid="status-dot-offline"
      className="inline-block w-3 h-3 rounded-full bg-status-offline"
    />
  );
}

export default function Home() {
  const { data, isLoading, isError, refetch, isFetching } = useQuery<BotStatus>({
    queryKey: ["/api/bot/status"],
    refetchInterval: 5000,
  });

  const statusLabel =
    data?.status === "online"
      ? "Online"
      : data?.status === "error"
      ? "Error"
      : "Offline";

  const statusColor =
    data?.status === "online"
      ? "text-status-online"
      : data?.status === "error"
      ? "text-status-busy"
      : "text-status-offline";

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
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

          <Button
            variant="secondary"
            size="sm"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${isFetching ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>

        {/* Bot Identity Card */}
        <Card className="border-card-border bg-card">
          <CardContent className="p-6">
            <div className="flex flex-wrap items-center gap-5">
              {/* Avatar */}
              <div className="relative flex-shrink-0">
                {isLoading ? (
                  <Skeleton className="w-20 h-20 rounded-full" />
                ) : data?.avatarUrl ? (
                  <img
                    src={data.avatarUrl}
                    alt="Bot avatar"
                    data-testid="img-avatar"
                    className="w-20 h-20 rounded-full border-2 border-primary/30 object-cover"
                  />
                ) : (
                  <div className="w-20 h-20 rounded-full border-2 border-border bg-muted flex items-center justify-center">
                    <SiDiscord className="w-9 h-9 text-muted-foreground" />
                  </div>
                )}
                {/* Status indicator on avatar */}
                <div className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-card border-2 border-card flex items-center justify-center">
                  {!isLoading && <StatusDot status={data?.status ?? "offline"} />}
                </div>
              </div>

              {/* Identity info */}
              <div className="flex-1 min-w-0 space-y-1">
                {isLoading ? (
                  <>
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-32" />
                  </>
                ) : (
                  <>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2
                        className="text-lg font-semibold text-foreground truncate"
                        data-testid="text-bot-tag"
                      >
                        {data?.tag ?? "Not connected"}
                      </h2>
                      <Badge
                        variant="secondary"
                        data-testid="badge-status"
                        className={`text-xs font-medium ${statusColor}`}
                      >
                        {statusLabel}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                      <Eye className="w-3.5 h-3.5 flex-shrink-0" />
                      <span data-testid="text-activity">
                        {data?.online
                          ? `${data.activityType} ${data.activityName}`
                          : "No activity"}
                      </span>
                    </div>
                  </>
                )}
              </div>

              {/* Connection icon */}
              <div className="flex-shrink-0">
                {isLoading ? (
                  <Skeleton className="w-10 h-10 rounded-md" />
                ) : data?.online ? (
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

        {/* Stats Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Status */}
          <Card className="border-card-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Status
              </CardTitle>
              <Activity className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? (
                <Skeleton className="h-8 w-24" />
              ) : (
                <div className="flex items-center gap-2">
                  <StatusDot status={data?.status ?? "offline"} />
                  <span
                    className={`text-2xl font-bold ${statusColor}`}
                    data-testid="text-status-value"
                  >
                    {statusLabel}
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Servers */}
          <Card className="border-card-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Servers
              </CardTitle>
              <Server className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? (
                <Skeleton className="h-8 w-16" />
              ) : (
                <span
                  className="text-2xl font-bold text-foreground"
                  data-testid="text-guild-count"
                >
                  {data?.guildCount ?? 0}
                </span>
              )}
            </CardContent>
          </Card>

          {/* Uptime */}
          <Card className="border-card-border bg-card">
            <CardHeader className="flex flex-row items-center justify-between gap-1 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Uptime
              </CardTitle>
              <Clock className="w-4 h-4 text-muted-foreground" />
            </CardHeader>
            <CardContent className="pt-0">
              {isLoading ? (
                <Skeleton className="h-8 w-28" />
              ) : (
                <span
                  className="text-2xl font-bold text-foreground"
                  data-testid="text-uptime"
                >
                  {formatUptime(data?.uptimeStart ?? null)}
                </span>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Error / Info panel */}
        {!isLoading && (isError || data?.lastError) && (
          <Card className="border-destructive/40 bg-destructive/5">
            <CardContent className="p-4 flex items-start gap-3">
              <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
              <div className="space-y-1">
                <p className="text-sm font-medium text-destructive">Connection error</p>
                <p className="text-sm text-muted-foreground" data-testid="text-error-message">
                  {data?.lastError ?? "Could not reach the bot. Check that your TOKEN is valid."}
                </p>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Live presence info */}
        {!isLoading && data?.online && (
          <Card className="border-card-border bg-card">
            <CardHeader>
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Live Presence
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex items-center gap-3 p-3 rounded-md bg-muted/40">
                <div className="w-8 h-8 rounded-md bg-primary/15 flex items-center justify-center flex-shrink-0">
                  <Eye className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground uppercase tracking-wide font-medium">
                    {data.activityType}
                  </p>
                  <p className="text-sm text-foreground font-medium" data-testid="text-presence-name">
                    {data.activityName}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Footer note */}
        <p className="text-center text-xs text-muted-foreground" data-testid="text-footer">
          Status refreshes automatically every 5 seconds
        </p>
      </div>
    </div>
  );
}
