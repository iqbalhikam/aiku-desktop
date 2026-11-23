#Requires -Version 5.1
param(
  [string]$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName PresentationFramework
Add-Type -AssemblyName PresentationCore
Add-Type -AssemblyName WindowsBase

$workerScript = Join-Path $ProjectRoot "dist\rpc\worker.js"
if (-not (Test-Path $workerScript)) {
  [System.Windows.MessageBox]::Show(
    "Worker Node.js tidak ditemukan di $workerScript. Jalankan 'npm run build' terlebih dahulu.",
    "aiKu",
    [System.Windows.MessageBoxButton]::OK,
    [System.Windows.MessageBoxImage]::Error
  ) | Out-Null
  exit 1
}

# ==========================================================
# 1. NODE.JS P0 SECURITY WORKER (JSON-RPC via STDIO)
# ==========================================================
$psi = New-Object System.Diagnostics.ProcessStartInfo
$psi.FileName = "node"
$psi.Arguments = "`"$workerScript`""
$psi.WorkingDirectory = $ProjectRoot
$psi.UseShellExecute = $false
$psi.CreateNoWindow = $true
$psi.RedirectStandardInput = $true
$psi.RedirectStandardOutput = $true
$psi.RedirectStandardError = $true
$psi.StandardOutputEncoding = [System.Text.Encoding]::UTF8

$script:NodeProc = New-Object System.Diagnostics.Process
$script:NodeProc.StartInfo = $psi
[void]$script:NodeProc.Start()

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$script:NodeStdin = New-Object System.IO.StreamWriter($script:NodeProc.StandardInput.BaseStream, $utf8NoBom)
$script:NodeStdin.AutoFlush = $true

$script:RpcId = 0
$script:PendingCallbacks = @{}
$script:ChatHistory = New-Object System.Collections.ArrayList
$script:ActivePlan = $null
$script:SandboxRoot = ""
$script:LastAiReply = ""

# ==========================================================
# 2. APPLE-GRADE POLISHED DYNAMIC ISLAND XAML
# ==========================================================
[xml]$xaml = @"
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
        xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
        Title="aiKu"
        WindowStyle="None"
        AllowsTransparency="True"
        Background="Transparent"
        Topmost="True"
        ShowInTaskbar="False"
        ResizeMode="NoResize"
        SizeToContent="WidthAndHeight"
        WindowStartupLocation="Manual"
        FontFamily="Segoe UI Variable Text, Segoe UI"
        UseLayoutRounding="True"
        SnapsToDevicePixels="True"
        TextOptions.TextFormattingMode="Display"
        TextOptions.TextRenderingMode="ClearType">

  <Window.Resources>
    <!-- Ultra-thin modern dark scrollbar -->
    <Style TargetType="ScrollBar">
      <Setter Property="Width" Value="5"/>
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="ScrollBar">
            <Grid Background="Transparent" Margin="2,4,0,4">
              <Track x:Name="PART_Track" IsDirectionReversed="True">
                <Track.Thumb>
                  <Thumb>
                    <Thumb.Template>
                      <ControlTemplate TargetType="Thumb">
                        <Border Background="#38FFFFFF" CornerRadius="2.5"/>
                      </ControlTemplate>
                    </Thumb.Template>
                  </Thumb>
                </Track.Thumb>
              </Track>
            </Grid>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <!-- Action Pill Button -->
    <Style x:Key="PillBtn" TargetType="Button">
      <Setter Property="Background" Value="#16161A"/>
      <Setter Property="Foreground" Value="#E4E4E7"/>
      <Setter Property="BorderBrush" Value="#1CFFFFFF"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="12,7"/>
      <Setter Property="Margin" Value="0,0,8,0"/>
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="FontWeight" Value="Medium"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="10" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bd" Property="Background" Value="#24242A"/>
                <Setter TargetName="bd" Property="BorderBrush" Value="#38FFFFFF"/>
              </Trigger>
              <Trigger Property="IsPressed" Value="True">
                <Setter TargetName="bd" Property="Background" Value="#1C1C22"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <!-- Ghost Text Button -->
    <Style x:Key="GhostBtn" TargetType="Button">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Foreground" Value="#8E8E98"/>
      <Setter Property="Padding" Value="8,5"/>
      <Setter Property="FontSize" Value="11.5"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" Background="{TemplateBinding Background}" CornerRadius="8" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bd" Property="Background" Value="#18FFFFFF"/>
                <Setter Property="Foreground" Value="#F4F4F5"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <!-- Circular Icon Button -->
    <Style x:Key="IconBtn" TargetType="Button">
      <Setter Property="Background" Value="Transparent"/>
      <Setter Property="Foreground" Value="#71717A"/>
      <Setter Property="Width" Value="26"/>
      <Setter Property="Height" Value="26"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" Background="{TemplateBinding Background}" CornerRadius="13">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bd" Property="Background" Value="#1EFFFFFF"/>
                <Setter Property="Foreground" Value="#F4F4F5"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <!-- Primary Emerald Apply Button -->
    <Style x:Key="PrimaryBtn" TargetType="Button">
      <Setter Property="Background" Value="#22E58A"/>
      <Setter Property="Foreground" Value="#032113"/>
      <Setter Property="FontWeight" Value="SemiBold"/>
      <Setter Property="FontSize" Value="12"/>
      <Setter Property="Padding" Value="16,7"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" Background="{TemplateBinding Background}" CornerRadius="10" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bd" Property="Background" Value="#4DF2A6"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="bd" Property="Opacity" Value="0.38"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>

    <!-- Small Emerald Rollback Pill -->
    <Style x:Key="UndoRowBtn" TargetType="Button">
      <Setter Property="Background" Value="#1E22E58A"/>
      <Setter Property="Foreground" Value="#22E58A"/>
      <Setter Property="BorderBrush" Value="#4422E58A"/>
      <Setter Property="BorderThickness" Value="1"/>
      <Setter Property="Padding" Value="10,4"/>
      <Setter Property="FontSize" Value="11"/>
      <Setter Property="FontWeight" Value="Medium"/>
      <Setter Property="Cursor" Value="Hand"/>
      <Setter Property="FocusVisualStyle" Value="{x:Null}"/>
      <Setter Property="Template">
        <Setter.Value>
          <ControlTemplate TargetType="Button">
            <Border x:Name="bd" Background="{TemplateBinding Background}" BorderBrush="{TemplateBinding BorderBrush}" BorderThickness="{TemplateBinding BorderThickness}" CornerRadius="8" Padding="{TemplateBinding Padding}">
              <ContentPresenter HorizontalAlignment="Center" VerticalAlignment="Center"/>
            </Border>
            <ControlTemplate.Triggers>
              <Trigger Property="IsMouseOver" Value="True">
                <Setter TargetName="bd" Property="Background" Value="#3422E58A"/>
              </Trigger>
              <Trigger Property="IsEnabled" Value="False">
                <Setter TargetName="bd" Property="Opacity" Value="0.4"/>
              </Trigger>
            </ControlTemplate.Triggers>
          </ControlTemplate>
        </Setter.Value>
      </Setter>
    </Style>
  </Window.Resources>

  <Grid Margin="22,8,22,26">
    <StackPanel HorizontalAlignment="Center">
      <!-- FLOATING OBSIDIAN DYNAMIC ISLAND SHELL -->
      <Border x:Name="IslandShell"
              Width="206"
              BorderBrush="#26FFFFFF"
              BorderThickness="1"
              CornerRadius="19"
              ClipToBounds="True">
        <Border.Background>
          <LinearGradientBrush StartPoint="0,0" EndPoint="0,1">
            <GradientStop Color="#FA0D0D11" Offset="0"/>
            <GradientStop Color="#FA070709" Offset="1"/>
          </LinearGradientBrush>
        </Border.Background>
        <Border.Effect>
          <DropShadowEffect BlurRadius="26" ShadowDepth="8" Opacity="0.62" Color="#000000"/>
        </Border.Effect>

        <Grid>
          <!-- =========================================
               STATE 1: SLEEK IDLE PILL (206 x 38)
               ========================================= -->
          <Grid x:Name="ViewIdle" Height="38" Cursor="Hand" Visibility="Visible" Background="Transparent">
            <Grid.ContextMenu>
              <ContextMenu>
                <MenuItem x:Name="MenuOpen" Header="Buka aiKu"/>
                <MenuItem x:Name="MenuQuit" Header="Tutup aiKu"/>
              </ContextMenu>
            </Grid.ContextMenu>
            <Grid.ColumnDefinitions>
              <ColumnDefinition Width="*"/>
              <ColumnDefinition Width="Auto"/>
            </Grid.ColumnDefinitions>
            <StackPanel Orientation="Horizontal" VerticalAlignment="Center" Margin="14,0,0,0">
              <Ellipse x:Name="IdleDot" Width="7" Height="7" Fill="#22E58A" Margin="0,0,9,0">
                <Ellipse.Triggers>
                  <EventTrigger RoutedEvent="Loaded">
                    <BeginStoryboard>
                      <Storyboard RepeatBehavior="Forever" AutoReverse="True">
                        <DoubleAnimation Storyboard.TargetProperty="Opacity" From="1.0" To="0.35" Duration="0:0:1.6"/>
                      </Storyboard>
                    </BeginStoryboard>
                  </EventTrigger>
                </Ellipse.Triggers>
              </Ellipse>
              <Path Data="M12,2 L14.4,9.6 L22,12 L14.4,14.4 L12,22 L9.6,14.4 L2,12 L9.6,9.6 Z"
                    Fill="#38BDF8" Width="12" Height="12" Stretch="Uniform" Margin="0,0,7,0" VerticalAlignment="Center"/>
              <TextBlock x:Name="IdleLabel" Text="AI Ready" Foreground="#F4F4F5" FontSize="12.5" FontWeight="SemiBold" VerticalAlignment="Center"/>
            </StackPanel>
            <Border Grid.Column="1" Background="#1D1D22" BorderBrush="#14FFFFFF" BorderThickness="1" CornerRadius="10" Padding="8,2.5" Margin="0,0,10,0" VerticalAlignment="Center">
              <TextBlock x:Name="IdleCount" Text="0 file" Foreground="#A1A1AA" FontSize="10.5" FontWeight="Medium"/>
            </Border>
          </Grid>

          <!-- =========================================
               STATE 2: ACTIVE THINKING PILL (360 x 58)
               ========================================= -->
          <Grid x:Name="ViewThinking" Height="58" Visibility="Collapsed">
            <Grid.ColumnDefinitions>
              <ColumnDefinition Width="Auto"/>
              <ColumnDefinition Width="*"/>
              <ColumnDefinition Width="Auto"/>
            </Grid.ColumnDefinitions>
            <Border Width="30" Height="30" CornerRadius="15" Margin="14,0,12,0" VerticalAlignment="Center">
              <Border.Background>
                <LinearGradientBrush StartPoint="0,0" EndPoint="1,1">
                  <GradientStop Color="#00F2FE" Offset="0"/>
                  <GradientStop Color="#A855F7" Offset="1"/>
                </LinearGradientBrush>
              </Border.Background>
              <Ellipse Width="10" Height="10" Fill="#09090B">
                <Ellipse.Triggers>
                  <EventTrigger RoutedEvent="Loaded">
                    <BeginStoryboard>
                      <Storyboard RepeatBehavior="Forever" AutoReverse="True">
                        <DoubleAnimation Storyboard.TargetProperty="Opacity" From="0.95" To="0.3" Duration="0:0:0.7"/>
                      </Storyboard>
                    </BeginStoryboard>
                  </EventTrigger>
                </Ellipse.Triggers>
              </Ellipse>
            </Border>
            <StackPanel Grid.Column="1" VerticalAlignment="Center">
              <TextBlock x:Name="ThinkingTitle" Text="Sebentar ya..." Foreground="#F4F4F5" FontSize="12.5" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/>
              <TextBlock x:Name="ThinkingSub" Text="Memproses secara lokal (offline)" Foreground="#71717A" FontSize="11" Margin="0,2,0,0"/>
            </StackPanel>
            <Button x:Name="BtnCancelThink" Grid.Column="2" Style="{StaticResource IconBtn}" Margin="8,0,14,0" ToolTip="Kembali">
              <Path Data="M6,6 L18,6 L18,18 L6,18 Z" Fill="#FCA5A5" Width="9" Height="9" Stretch="Uniform"/>
            </Button>
          </Grid>

          <!-- =========================================
               STATE 3: SIMPLE QUICK ASSISTANT (460 wide)
               ========================================= -->
          <StackPanel x:Name="ViewPalette" Margin="16,14,16,10" Visibility="Collapsed">
            <!-- Clean Frameless Input -->
            <Grid Margin="0,0,0,12">
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
              </Grid.ColumnDefinitions>
              <Path Data="M12,2 L14.4,9.6 L22,12 L14.4,14.4 L12,22 L9.6,14.4 L2,12 L9.6,9.6 Z"
                    Fill="#38BDF8" Width="15" Height="15" Stretch="Uniform" Margin="2,0,10,0" VerticalAlignment="Center"/>
              <Grid Grid.Column="1" VerticalAlignment="Center">
                <TextBlock x:Name="InputPlaceholder" Text="Tanya AI, cari file, atau ketik perintah..." Foreground="#5A5A66" FontSize="13.5" IsHitTestVisible="False" VerticalAlignment="Center"/>
                <TextBox x:Name="PaletteInput" Background="Transparent" Foreground="#F4F4F5" CaretBrush="#38BDF8" BorderThickness="0" FontSize="13.5" VerticalContentAlignment="Center"/>
              </Grid>
              <Button x:Name="BtnQuitPalette" Grid.Column="2" Style="{StaticResource IconBtn}" ToolTip="Tutup aiKu">
                <Path Data="M6,6 L18,18 M18,6 L6,18" Stroke="{Binding Foreground, RelativeSource={RelativeSource AncestorType=Button}}" StrokeThickness="1.8" Width="11" Height="11" Stretch="Uniform"/>
              </Button>
            </Grid>

            <!-- 3 Clean Action Pills with Vector Icons -->
            <StackPanel Orientation="Horizontal" Margin="0,0,0,10">
              <Button x:Name="ChipOrganize" Style="{StaticResource PillBtn}">
                <StackPanel Orientation="Horizontal">
                  <Path Data="M3,7 C3,5.9 3.9,5 5,5 L9,5 L11,7 L19,7 C20.1,7 21,7.9 21,9 L21,17 C21,18.1 20.1,19 19,19 L5,19 C3.9,19 3,18.1 3,17 Z"
                        Stroke="#22E58A" StrokeThickness="1.7" Fill="Transparent" Width="13" Height="13" Stretch="Uniform" Margin="0,0,7,0"/>
                  <TextBlock Text="Rapikan File" VerticalAlignment="Center"/>
                </StackPanel>
              </Button>

              <Button x:Name="ChipDuplicates" Style="{StaticResource PillBtn}">
                <StackPanel Orientation="Horizontal">
                  <Path Data="M11,4 A7,7 0 1 0 11,18 A7,7 0 1 0 11,4 M20,20 L16.2,16.2"
                        Stroke="#C084FC" StrokeThickness="1.8" Fill="Transparent" Width="13" Height="13" Stretch="Uniform" Margin="0,0,7,0"/>
                  <TextBlock Text="Cek Duplikat" VerticalAlignment="Center"/>
                </StackPanel>
              </Button>

              <Button x:Name="ChipClipboard" Style="{StaticResource PillBtn}" Margin="0">
                <StackPanel Orientation="Horizontal">
                  <Path Data="M9,3 L15,3 L15,6 L9,6 Z M7,5 L5,5 L5,20 L19,20 L19,5 L17,5"
                        Stroke="#38BDF8" StrokeThickness="1.7" Fill="Transparent" Width="13" Height="13" Stretch="Uniform" Margin="0,0,7,0"/>
                  <TextBlock Text="Ringkas Clipboard" VerticalAlignment="Center"/>
                </StackPanel>
              </Button>
            </StackPanel>

            <!-- Compact Reply Card -->
            <Border x:Name="ReplyBox" Background="#141418" BorderBrush="#14FFFFFF" BorderThickness="1" CornerRadius="12" Padding="12,10" Margin="0,2,0,10" Visibility="Collapsed">
              <StackPanel>
                <Grid>
                  <Grid.ColumnDefinitions>
                    <ColumnDefinition Width="*"/>
                    <ColumnDefinition Width="Auto"/>
                  </Grid.ColumnDefinitions>
                  <TextBlock x:Name="ReplyText" Text="" Foreground="#E4E4E7" FontSize="12.5" LineHeight="18" TextWrapping="Wrap"/>
                  <Button x:Name="BtnCopyReply" Grid.Column="1" Content="Salin" Style="{StaticResource PillBtn}" Padding="9,4" Margin="10,0,0,0" FontSize="11" VerticalAlignment="Top" Visibility="Collapsed"/>
                </Grid>
                <ScrollViewer x:Name="ReplyFilesScroll" MaxHeight="135" VerticalScrollBarVisibility="Auto" Margin="0,8,0,0" Visibility="Collapsed">
                  <StackPanel x:Name="ReplyFilesList"/>
                </ScrollViewer>
              </StackPanel>
            </Border>

            <!-- Clean Minimal Footer -->
            <Grid Margin="0,2,0,0">
              <TextBlock x:Name="PaletteStatus" Text="sandbox • offline" Foreground="#5A5A66" FontSize="11" VerticalAlignment="Center"/>
              <Border x:Name="HandlePalette" Width="38" Height="4" CornerRadius="2" Background="#2C2C34" HorizontalAlignment="Center" VerticalAlignment="Center" Cursor="Hand" ToolTip="Perkecil (Esc)"/>
              <Button x:Name="BtnOpenUndo" Content="Undo" Style="{StaticResource GhostBtn}" HorizontalAlignment="Right" Padding="8,3"/>
            </Grid>
          </StackPanel>

          <!-- =========================================
               STATE 4: PREVIEW PERUBAHAN / UNDO (560 wide)
               ========================================= -->
          <StackPanel x:Name="ViewPreview" Margin="16,14,16,10" Visibility="Collapsed">
            <!-- Header -->
            <Grid Margin="0,0,0,12">
              <StackPanel Orientation="Horizontal" VerticalAlignment="Center">
                <Border Width="28" Height="28" CornerRadius="9" Background="#1A22E58A" Margin="0,0,10,0">
                  <Path Data="M12,3 L19,6 L19,12 C19,16.5 16,19.5 12,21 C8,19.5 5,16.5 5,12 L5,6 Z"
                        Stroke="#22E58A" StrokeThickness="1.7" Fill="Transparent" Width="14" Height="14" Stretch="Uniform"/>
                </Border>
                <TextBlock x:Name="PreviewTitle" Text="Preview Perubahan" Foreground="#F4F4F5" FontSize="14.5" FontWeight="SemiBold" VerticalAlignment="Center"/>
              </StackPanel>
              <Border Background="#1622E58A" BorderBrush="#3322E58A" BorderThickness="1" CornerRadius="10" Padding="10,4" HorizontalAlignment="Right" VerticalAlignment="Center">
                <StackPanel Orientation="Horizontal">
                  <Ellipse Width="6" Height="6" Fill="#22E58A" Margin="0,0,6,0" VerticalAlignment="Center"/>
                  <TextBlock Text="Aman • Tidak Hapus File" Foreground="#22E58A" FontSize="10.5" FontWeight="Medium"/>
                </StackPanel>
              </Border>
            </Grid>

            <!-- Operations / Undo List -->
            <ScrollViewer MaxHeight="225" VerticalScrollBarVisibility="Auto" Margin="0,0,0,14">
              <StackPanel x:Name="PreviewList"/>
            </ScrollViewer>

            <!-- Action Footer -->
            <Grid Margin="0,0,0,6">
              <Grid.ColumnDefinitions>
                <ColumnDefinition Width="Auto"/>
                <ColumnDefinition Width="*"/>
                <ColumnDefinition Width="Auto"/>
              </Grid.ColumnDefinitions>
              <Button x:Name="BtnPreviewUndo" Content="Riwayat Undo" Style="{StaticResource PillBtn}" Margin="0" Padding="11,6"/>
              <StackPanel Grid.Column="2" Orientation="Horizontal">
                <Button x:Name="BtnPreviewCancel" Content="Batal" Style="{StaticResource GhostBtn}" Margin="0,0,6,0" Padding="12,6"/>
                <Button x:Name="BtnPreviewApply" Content="Terapkan" Style="{StaticResource PrimaryBtn}"/>
              </StackPanel>
            </Grid>

            <Border x:Name="HandlePreview" Width="38" Height="4" CornerRadius="2" Background="#2C2C34" HorizontalAlignment="Center" Cursor="Hand" ToolTip="Perkecil (Esc)"/>
          </StackPanel>
        </Grid>
      </Border>

      <!-- Floating Toast -->
      <Border x:Name="ToastBar" Background="#F2121216" BorderBrush="#3822E58A" BorderThickness="1" CornerRadius="14" Padding="14,6" Margin="0,10,0,0" HorizontalAlignment="Center" Visibility="Collapsed">
        <TextBlock x:Name="ToastText" Text="" Foreground="#22E58A" FontSize="11.5" FontWeight="Medium"/>
      </Border>
    </StackPanel>
  </Grid>
</Window>
"@

$reader = New-Object System.Xml.XmlNodeReader($xaml)
$window = [Windows.Markup.XamlReader]::Load($reader)

# Bind UI elements
$IslandShell      = $window.FindName("IslandShell")
$ViewIdle         = $window.FindName("ViewIdle")
$ViewThinking     = $window.FindName("ViewThinking")
$ViewPalette      = $window.FindName("ViewPalette")
$ViewPreview      = $window.FindName("ViewPreview")
$MenuOpen         = $window.FindName("MenuOpen")
$MenuQuit         = $window.FindName("MenuQuit")
$IdleLabel        = $window.FindName("IdleLabel")
$IdleCount        = $window.FindName("IdleCount")
$ThinkingTitle    = $window.FindName("ThinkingTitle")
$ThinkingSub      = $window.FindName("ThinkingSub")
$BtnCancelThink   = $window.FindName("BtnCancelThink")
$InputPlaceholder = $window.FindName("InputPlaceholder")
$PaletteInput     = $window.FindName("PaletteInput")
$BtnQuitPalette   = $window.FindName("BtnQuitPalette")
$ChipOrganize     = $window.FindName("ChipOrganize")
$ChipDuplicates   = $window.FindName("ChipDuplicates")
$ChipClipboard    = $window.FindName("ChipClipboard")
$ReplyBox         = $window.FindName("ReplyBox")
$ReplyText        = $window.FindName("ReplyText")
$BtnCopyReply     = $window.FindName("BtnCopyReply")
$ReplyFilesScroll = $window.FindName("ReplyFilesScroll")
$ReplyFilesList   = $window.FindName("ReplyFilesList")
$PaletteStatus    = $window.FindName("PaletteStatus")
$HandlePalette    = $window.FindName("HandlePalette")
$BtnOpenUndo      = $window.FindName("BtnOpenUndo")
$PreviewTitle     = $window.FindName("PreviewTitle")
$PreviewList      = $window.FindName("PreviewList")
$BtnPreviewUndo   = $window.FindName("BtnPreviewUndo")
$BtnPreviewCancel = $window.FindName("BtnPreviewCancel")
$BtnPreviewApply  = $window.FindName("BtnPreviewApply")
$HandlePreview    = $window.FindName("HandlePreview")
$ToastBar         = $window.FindName("ToastBar")
$ToastText        = $window.FindName("ToastText")
$UndoRowBtnStyle  = $window.Resources["UndoRowBtn"]

function Center-TopFloating([double]$targetShellWidth) {
  $screenWidth = [System.Windows.SystemParameters]::PrimaryScreenWidth
  $totalWidth = $targetShellWidth + 44
  $window.Left = [Math]::Round(($screenWidth - $totalWidth) / 2)
  $window.Top = 6
}

function Animate-ShellWidth([double]$targetWidth) {
  $ease = New-Object System.Windows.Media.Animation.CubicEase
  $ease.EasingMode = [System.Windows.Media.Animation.EasingMode]::EaseOut
  $anim = New-Object System.Windows.Media.Animation.DoubleAnimation
  $anim.To = $targetWidth
  $anim.Duration = [System.Windows.Duration]([TimeSpan]::FromMilliseconds(210))
  $anim.EasingFunction = $ease
  $IslandShell.BeginAnimation([System.Windows.FrameworkElement]::WidthProperty, $anim)
  Center-TopFloating $targetWidth
}

function Set-IslandState([string]$state) {
  $ViewIdle.Visibility     = if ($state -eq "idle")     { "Visible" } else { "Collapsed" }
  $ViewThinking.Visibility = if ($state -eq "thinking") { "Visible" } else { "Collapsed" }
  $ViewPalette.Visibility  = if ($state -eq "palette")  { "Visible" } else { "Collapsed" }
  $ViewPreview.Visibility  = if ($state -eq "preview")  { "Visible" } else { "Collapsed" }

  switch ($state) {
    "idle" {
      $IslandShell.CornerRadius = New-Object System.Windows.CornerRadius(19)
      $IslandShell.BorderBrush = "#26FFFFFF"
      Animate-ShellWidth 206
    }
    "thinking" {
      $IslandShell.CornerRadius = New-Object System.Windows.CornerRadius(29)
      $IslandShell.BorderBrush = "#5538BDF8"
      Animate-ShellWidth 360
    }
    "palette" {
      $IslandShell.CornerRadius = New-Object System.Windows.CornerRadius(22)
      $IslandShell.BorderBrush = "#26FFFFFF"
      Animate-ShellWidth 460
    }
    "preview" {
      $IslandShell.CornerRadius = New-Object System.Windows.CornerRadius(22)
      $IslandShell.BorderBrush = "#3D22E58A"
      Animate-ShellWidth 560
    }
  }

  if ($state -eq "palette") {
    $window.Activate() | Out-Null
    $PaletteInput.Focus() | Out-Null
  }
}

$script:ToastTimer = New-Object System.Windows.Threading.DispatcherTimer
$script:ToastTimer.Interval = [TimeSpan]::FromSeconds(4)
$script:ToastTimer.Add_Tick({
  $ToastBar.Visibility = "Collapsed"
  $script:ToastTimer.Stop()
})

function Show-Toast([string]$msg, [bool]$isError = $false) {
  $ToastText.Text = $msg
  if ($isError) {
    $ToastText.Foreground = "#FCA5A5"
    $ToastBar.BorderBrush = "#55FCA5A5"
  } else {
    $ToastText.Foreground = "#22E58A"
    $ToastBar.BorderBrush = "#4422E58A"
  }
  $ToastBar.Visibility = "Visible"
  $script:ToastTimer.Stop()
  $script:ToastTimer.Start()
}

function Get-RelativePath([string]$fullPath) {
  if ([string]::IsNullOrWhiteSpace($script:SandboxRoot)) { return $fullPath }
  $normRoot = $script:SandboxRoot.TrimEnd('\', '/')
  if ($fullPath.StartsWith($normRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
    return $fullPath.Substring($normRoot.Length).TrimStart('\', '/')
  }
  return $fullPath
}

function Invoke-NodeRpc([string]$method, [hashtable]$params, [scriptblock]$onResult) {
  $script:RpcId++
  $id = $script:RpcId
  $script:PendingCallbacks[$id] = $onResult
  $payload = @{
    id = $id
    method = $method
    params = $params
  } | ConvertTo-Json -Depth 10 -Compress
  $script:NodeStdin.WriteLine($payload)
}

$script:OutputHandler = [System.Diagnostics.DataReceivedEventHandler]{
  param($sender, $e)
  if ([string]::IsNullOrWhiteSpace($e.Data)) { return }
  $line = $e.Data
  $window.Dispatcher.Invoke([Action]{
    try {
      $resp = $line | ConvertFrom-Json
      $id = [int]$resp.id
      if ($script:PendingCallbacks.ContainsKey($id)) {
        $cb = $script:PendingCallbacks[$id]
        $script:PendingCallbacks.Remove($id)
        & $cb $resp
      }
    } catch {
      Show-Toast "Gagal membaca respons sistem." $true
    }
  })
}
$script:NodeProc.add_OutputDataReceived($script:OutputHandler)
$script:NodeProc.BeginOutputReadLine()

function Show-PaletteReply([string]$text, $files = $null, [bool]$showCopy = $false) {
  $clean = $text -replace '\*\*([^*]+)\*\*', '$1'
  $script:LastAiReply = $clean
  $ReplyText.Text = $clean
  $BtnCopyReply.Visibility = if ($showCopy) { "Visible" } else { "Collapsed" }
  $ReplyFilesList.Children.Clear()

  if ($null -ne $files -and $files.Count -gt 0) {
    $ReplyFilesScroll.Visibility = "Visible"
    foreach ($f in $files) {
      $row = New-Object System.Windows.Controls.Border
      $row.Background = "#1C1C22"
      $row.CornerRadius = New-Object System.Windows.CornerRadius(8)
      $row.Padding = New-Object System.Windows.Thickness(10, 6, 10, 6)
      $row.Margin = New-Object System.Windows.Thickness(0, 0, 0, 5)

      $g = New-Object System.Windows.Controls.Grid
      $nameTb = New-Object System.Windows.Controls.TextBlock
      $nameTb.Text = $f.relativePath
      $nameTb.Foreground = "#E4E4E7"
      $nameTb.FontSize = 11.5
      $nameTb.FontWeight = "Medium"
      [void]$g.Children.Add($nameTb)

      $sizeTb = New-Object System.Windows.Controls.TextBlock
      $sizeTb.Text = "$($f.sizeBytes) B"
      $sizeTb.Foreground = "#71717A"
      $sizeTb.FontSize = 10.5
      $sizeTb.HorizontalAlignment = "Right"
      [void]$g.Children.Add($sizeTb)

      $row.Child = $g
      [void]$ReplyFilesList.Children.Add($row)
    }
  } else {
    $ReplyFilesScroll.Visibility = "Collapsed"
  }

  $ReplyBox.Visibility = "Visible"
  Set-IslandState "palette"
}

function Show-PlanPreview($plan, [string]$title = "Preview Perubahan") {
  $script:ActivePlan = $plan
  $ops = @($plan.operations)
  $PreviewTitle.Text = $title
  $BtnPreviewApply.Visibility = "Visible"
  $BtnPreviewApply.IsEnabled = ($ops.Count -gt 0)
  $BtnPreviewApply.Content = if ($ops.Count -gt 0) { "Terapkan ($($ops.Count))" } else { "Tidak Ada" }
  $BtnPreviewUndo.Visibility = "Visible"

  $PreviewList.Children.Clear()

  if ($ops.Count -eq 0) {
    $tb = New-Object System.Windows.Controls.TextBlock
    $tb.Text = "Semua file di sandbox sudah rapi."
    $tb.Foreground = "#A1A1AA"
    $tb.FontSize = 12.5
    $tb.Margin = New-Object System.Windows.Thickness(4, 8, 4, 8)
    [void]$PreviewList.Children.Add($tb)
  } else {
    foreach ($op in $ops) {
      $isQ = ($op.origin -eq "HYGIENE_QUARANTINE")
      $card = New-Object System.Windows.Controls.Border
      $card.Background = "#141418"
      $card.BorderBrush = "#12FFFFFF"
      $card.BorderThickness = New-Object System.Windows.Thickness(1)
      $card.CornerRadius = New-Object System.Windows.CornerRadius(11)
      $card.Padding = New-Object System.Windows.Thickness(12, 9, 12, 9)
      $card.Margin = New-Object System.Windows.Thickness(0, 0, 0, 6)

      $grid = New-Object System.Windows.Controls.Grid
      $c1 = New-Object System.Windows.Controls.ColumnDefinition; $c1.Width = "*"
      $c2 = New-Object System.Windows.Controls.ColumnDefinition; $c2.Width = "Auto"
      [void]$grid.ColumnDefinitions.Add($c1)
      [void]$grid.ColumnDefinitions.Add($c2)

      $pathTb = New-Object System.Windows.Controls.TextBlock
      $pathTb.Text = "$(Get-RelativePath $op.source)  →  $(Get-RelativePath $op.destination)"
      $pathTb.Foreground = if ($isQ) { "#FCA5A5" } else { "#F4F4F5" }
      $pathTb.FontSize = 12
      $pathTb.VerticalAlignment = "Center"
      $pathTb.TextTrimming = "CharacterEllipsis"
      [System.Windows.Controls.Grid]::SetColumn($pathTb, 0)
      [void]$grid.Children.Add($pathTb)

      $badge = New-Object System.Windows.Controls.Border
      $badge.CornerRadius = New-Object System.Windows.CornerRadius(7)
      $badge.Padding = New-Object System.Windows.Thickness(8, 3, 8, 3)
      $badge.Margin = New-Object System.Windows.Thickness(10, 0, 0, 0)
      $badge.Background = if ($isQ) { "#3A7F1D1D" } elseif ($op.action -eq "RENAME") { "#3A581C87" } else { "#280284C7" }

      $bTb = New-Object System.Windows.Controls.TextBlock
      $bTb.Text = if ($isQ) { "KARANTINA" } elseif ($op.action -eq "RENAME") { "UBAH NAMA" } else { "PINDAH" }
      $bTb.Foreground = if ($isQ) { "#FCA5A5" } elseif ($op.action -eq "RENAME") { "#D8B4FE" } else { "#7DD3FC" }
      $bTb.FontSize = 10
      $bTb.FontWeight = "SemiBold"
      $badge.Child = $bTb
      [System.Windows.Controls.Grid]::SetColumn($badge, 1)
      [void]$grid.Children.Add($badge)

      $card.Child = $grid
      [void]$PreviewList.Children.Add($card)
    }
  }

  Set-IslandState "preview"
}

function Show-UndoList {
  $ThinkingTitle.Text = "Memuat riwayat Undo..."
  $ThinkingSub.Text = "Memeriksa catatan file lokal"
  Set-IslandState "thinking"

  Invoke-NodeRpc "getHistory" @{} {
    param($resp)
    if (-not $resp.ok) {
      Show-Toast $resp.error $true
      Set-IslandState "palette"
      return
    }
    $script:ActivePlan = $null
    $records = @($resp.result.records)
    $PreviewTitle.Text = "Riwayat & Undo"
    $BtnPreviewApply.Visibility = "Collapsed"
    $BtnPreviewUndo.Visibility = "Collapsed"
    $PreviewList.Children.Clear()

    if ($records.Count -eq 0) {
      $tb = New-Object System.Windows.Controls.TextBlock
      $tb.Text = "Belum ada perubahan file yang dicatat."
      $tb.Foreground = "#A1A1AA"
      $tb.FontSize = 12.5
      [void]$PreviewList.Children.Add($tb)
    } else {
      foreach ($rec in ($records | Select-Object -First 8)) {
        $card = New-Object System.Windows.Controls.Border
        $card.Background = "#141418"
        $card.CornerRadius = New-Object System.Windows.CornerRadius(11)
        $card.Padding = New-Object System.Windows.Thickness(12, 9, 12, 9)
        $card.Margin = New-Object System.Windows.Thickness(0, 0, 0, 6)

        $grid = New-Object System.Windows.Controls.Grid
        $c1 = New-Object System.Windows.Controls.ColumnDefinition; $c1.Width = "*"
        $c2 = New-Object System.Windows.Controls.ColumnDefinition; $c2.Width = "Auto"
        [void]$grid.ColumnDefinitions.Add($c1)
        [void]$grid.ColumnDefinitions.Add($c2)

        $pTb = New-Object System.Windows.Controls.TextBlock
        $pTb.Text = "$(Get-RelativePath $rec.destination)  ↩  $(Get-RelativePath $rec.source)"
        $pTb.Foreground = "#E4E4E7"
        $pTb.FontSize = 12
        $pTb.VerticalAlignment = "Center"
        $pTb.TextTrimming = "CharacterEllipsis"
        [System.Windows.Controls.Grid]::SetColumn($pTb, 0)
        [void]$grid.Children.Add($pTb)

        $hasRb = ($null -ne $rec.PSObject.Properties["rolledBackAt"] -and -not [string]::IsNullOrWhiteSpace($rec.rolledBackAt))
        if ($hasRb) {
          $doneTb = New-Object System.Windows.Controls.TextBlock
          $doneTb.Text = "Sudah kembali"
          $doneTb.Foreground = "#71717A"
          $doneTb.FontSize = 11
          $doneTb.VerticalAlignment = "Center"
          [System.Windows.Controls.Grid]::SetColumn($doneTb, 1)
          [void]$grid.Children.Add($doneTb)
        } else {
          $rbBtn = New-Object System.Windows.Controls.Button
          $rbBtn.Content = "Kembalikan"
          $rbBtn.Tag = $rec.transactionId
          $rbBtn.Style = $UndoRowBtnStyle
          $rbBtn.Add_Click({
            param($s, $ev)
            $txId = [string]$s.Tag
            $s.IsEnabled = $false
            Invoke-NodeRpc "rollback" @{ transactionId = $txId } {
              param($rbResp)
              if ($rbResp.ok) {
                Show-Toast "File berhasil dikembalikan (SHA-256 cocok)." $false
                Refresh-Status
                Show-UndoList
              } else {
                Show-Toast $rbResp.error $true
                $s.IsEnabled = $true
              }
            }
          })
          [System.Windows.Controls.Grid]::SetColumn($rbBtn, 1)
          [void]$grid.Children.Add($rbBtn)
        }

        $card.Child = $grid
        [void]$PreviewList.Children.Add($card)
      }
    }
    Set-IslandState "preview"
  }
}

function Refresh-Status {
  Invoke-NodeRpc "getStatus" @{} {
    param($resp)
    if ($resp.ok) {
      $script:SandboxRoot = $resp.result.primarySandbox
      $folderName = Split-Path $script:SandboxRoot -Leaf
      $PaletteStatus.Text = "$folderName • offline"
      $IdleLabel.Text = if ($resp.result.modelReady) { "AI Ready" } else { "aiKu" }
    }
  }
  Invoke-NodeRpc "search" @{ query = "semua file"; useAi = $false } {
    param($resp)
    if ($resp.ok) {
      $cnt = @($resp.result.matches).Count
      $IdleCount.Text = "$cnt file"
    }
  }
}

function Send-Prompt([string]$msg) {
  $trimmed = $msg.Trim()
  if ([string]::IsNullOrWhiteSpace($trimmed)) { return }

  [void]$script:ChatHistory.Add(@{ role = "user"; content = $trimmed })
  $short = if ($trimmed.Length -gt 36) { $trimmed.Substring(0, 36) + "..." } else { $trimmed }
  $ThinkingTitle.Text = "`"$short`""
  $ThinkingSub.Text = "Memproses secara lokal (offline)"
  Set-IslandState "thinking"

  $recent = @($script:ChatHistory | Select-Object -Last 6)
  Invoke-NodeRpc "chat" @{
    message = $trimmed
    history = $recent
    enableAiForFiles = $false
  } {
    param($resp)
    if (-not $resp.ok) {
      Show-Toast $resp.error $true
      Set-IslandState "palette"
      return
    }
    $reply = [string]$resp.result.reply
    [void]$script:ChatHistory.Add(@{ role = "assistant"; content = $reply })

    $att = $resp.result.attachment
    if ($null -ne $att -and $att.type -eq "plan") {
      Show-PlanPreview $att.plan "Preview Perubahan"
    } elseif ($null -ne $att -and $att.type -eq "history") {
      Show-UndoList
    } elseif ($null -ne $att -and $att.type -eq "files") {
      Show-PaletteReply $reply @($att.files) $false
    } else {
      Show-PaletteReply $reply $null $true
    }
  }
}

# ==========================================================
# 3. EVENTS
# ==========================================================
$ViewIdle.Add_MouseLeftButtonUp({ Set-IslandState "palette" })
$MenuOpen.Add_Click({ Set-IslandState "palette" })
$MenuQuit.Add_Click({ $window.Close() })
$BtnQuitPalette.Add_Click({ $window.Close() })
$BtnCancelThink.Add_Click({ Set-IslandState "palette" })
$BtnPreviewCancel.Add_Click({ Set-IslandState "palette" })
$HandlePalette.Add_MouseLeftButtonUp({ Set-IslandState "idle" })
$HandlePreview.Add_MouseLeftButtonUp({ Set-IslandState "idle" })

$PaletteInput.Add_TextChanged({
  $InputPlaceholder.Visibility = if ([string]::IsNullOrEmpty($PaletteInput.Text)) { "Visible" } else { "Collapsed" }
})

$PaletteInput.Add_KeyDown({
  param($s, $e)
  if ($e.Key -eq [System.Windows.Input.Key]::Return) {
    $val = $PaletteInput.Text
    $PaletteInput.Text = ""
    Send-Prompt $val
  }
})

$BtnCopyReply.Add_Click({
  if (-not [string]::IsNullOrWhiteSpace($script:LastAiReply)) {
    [System.Windows.Clipboard]::SetText($script:LastAiReply)
    Show-Toast "Teks disalin ke clipboard." $false
  }
})

$ChipOrganize.Add_Click({
  $ThinkingTitle.Text = "Menyiapkan preview perapian..."
  $ThinkingSub.Text = "Aman • Tidak ada file yang diubah"
  Set-IslandState "thinking"
  Invoke-NodeRpc "planOrganize" @{ enableAi = $false } {
    param($resp)
    if ($resp.ok) {
      Show-PlanPreview $resp.result.plan "Preview Perapian File"
    } else {
      Show-Toast $resp.error $true
      Set-IslandState "palette"
    }
  }
})

$ChipDuplicates.Add_Click({
  $ThinkingTitle.Text = "Mencari duplikat & installer lama..."
  $ThinkingSub.Text = "Memeriksa hash SHA-256 lokal"
  Set-IslandState "thinking"
  Invoke-NodeRpc "planHygiene" @{} {
    param($resp)
    if ($resp.ok) {
      Show-PlanPreview $resp.result.plan "Preview Karantina"
    } else {
      Show-Toast $resp.error $true
      Set-IslandState "palette"
    }
  }
})

$ChipClipboard.Add_Click({
  $clip = [System.Windows.Clipboard]::GetText()
  if ([string]::IsNullOrWhiteSpace($clip)) {
    Show-Toast "Clipboard kosong. Copy teks dulu ya." $true
    return
  }
  $snippet = if ($clip.Length -gt 1200) { $clip.Substring(0, 1200) } else { $clip }
  Send-Prompt "Ringkas teks ini jadi 3 poin singkat:`n`n$snippet"
})

$BtnOpenUndo.Add_Click({ Show-UndoList })
$BtnPreviewUndo.Add_Click({ Show-UndoList })

$BtnPreviewApply.Add_Click({
  if ($null -eq $script:ActivePlan) { return }
  $planId = $script:ActivePlan.planId
  $ThinkingTitle.Text = "Menerapkan perubahan..."
  $ThinkingSub.Text = "Mencatat SHA-256 untuk Undo"
  Set-IslandState "thinking"
  Invoke-NodeRpc "executePlan" @{ planId = $planId; confirmToken = "CONFIRM_EXECUTE" } {
    param($resp)
    if ($resp.ok) {
      $script:ActivePlan = $null
      Show-Toast "Selesai! $($resp.result.executedCount) file diproses (bisa di-Undo)." $false
      Refresh-Status
      Set-IslandState "idle"
    } else {
      Show-Toast $resp.error $true
      Set-IslandState "preview"
    }
  }
})

$window.Add_KeyDown({
  param($s, $e)
  if ($e.Key -eq [System.Windows.Input.Key]::Escape) {
    Set-IslandState "idle"
  }
})

$window.Add_Loaded({
  Center-TopFloating 206
  Refresh-Status
})

$window.Add_Closed({
  try {
    if ($null -ne $script:NodeProc -and -not $script:NodeProc.HasExited) {
      $script:NodeProc.Kill()
    }
  } catch {}
})

[void]$window.ShowDialog()
