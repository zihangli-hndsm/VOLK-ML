param(
  [Parameter(Mandatory = $true)][string]$PythonPath,
  [Parameter(Mandatory = $true)][string]$WorkerPath,
  [Parameter(Mandatory = $true)][string]$SourcePath,
  [Parameter(Mandatory = $true)][int]$CoordinatorPid
)

$ErrorActionPreference = 'Stop'
$nativeSource = @'
using System;
using System.Runtime.InteropServices;
using System.Text;

public static class VolkH2JobSupervisor {
    const uint CREATE_SUSPENDED = 0x00000004;
    const uint CREATE_NO_WINDOW = 0x08000000;
    const uint STARTF_USESTDHANDLES = 0x00000100;
    const uint JOB_OBJECT_LIMIT_JOB_MEMORY = 0x00000200;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
    const int JobObjectExtendedLimitInformation = 9;
    const uint STD_INPUT_HANDLE = unchecked((uint)-10);
    const uint STD_OUTPUT_HANDLE = unchecked((uint)-11);
    const uint STD_ERROR_HANDLE = unchecked((uint)-12);
    const uint INFINITE = 0xffffffff;
    const uint PROCESS_SYNCHRONIZE = 0x00100000;

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct STARTUPINFO {
        public int cb;
        public string lpReserved;
        public string lpDesktop;
        public string lpTitle;
        public int dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars;
        public int dwFillAttribute;
        public uint dwFlags;
        public short wShowWindow, cbReserved2;
        public IntPtr lpReserved2, hStdInput, hStdOutput, hStdError;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct PROCESS_INFORMATION {
        public IntPtr hProcess, hThread;
        public uint dwProcessId, dwThreadId;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount;
        public ulong ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr lpJobAttributes, string lpName);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, ref JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool QueryInformationJobObject(IntPtr hJob, int infoClass, out JOBOBJECT_EXTENDED_LIMIT_INFORMATION info, uint length, out uint returnLength);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool IsProcessInJob(IntPtr hProcess, IntPtr hJob, out bool result);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string applicationName, StringBuilder commandLine, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint creationFlags, IntPtr environment, string currentDirectory, ref STARTUPINFO startupInfo, out PROCESS_INFORMATION processInformation);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint ResumeThread(IntPtr hThread);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateProcess(IntPtr hProcess, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForSingleObject(IntPtr hHandle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetExitCodeProcess(IntPtr hProcess, out uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr OpenProcess(uint access, bool inheritHandle, uint processId);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern uint WaitForMultipleObjects(uint count, IntPtr[] handles, bool waitAll, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool TerminateJobObject(IntPtr hJob, uint exitCode);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(uint handle);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool CloseHandle(IntPtr handle);

    static string Quote(string value) {
        var output = new StringBuilder("\"");
        int slashes = 0;
        foreach (char character in value) {
            if (character == '\\') { slashes++; continue; }
            if (character == '"') { output.Append('\\', slashes * 2 + 1).Append('"'); slashes = 0; continue; }
            output.Append('\\', slashes).Append(character);
            slashes = 0;
        }
        output.Append('\\', slashes * 2).Append('"');
        return output.ToString();
    }

    static void Check(bool value) {
        if (!value) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }

    public static int Run(string pythonPath, string workerPath, string sourcePath, uint coordinatorPid) {
        IntPtr job = IntPtr.Zero;
        IntPtr coordinator = IntPtr.Zero;
        PROCESS_INFORMATION process = new PROCESS_INFORMATION();
        bool created = false, resumed = false;
        try {
            job = CreateJobObject(IntPtr.Zero, null);
            Check(job != IntPtr.Zero);
            coordinator = OpenProcess(PROCESS_SYNCHRONIZE, false, coordinatorPid);
            Check(coordinator != IntPtr.Zero);
            var limits = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            limits.JobMemoryLimit = new UIntPtr(2147483648UL);
            uint informationSize = (uint)Marshal.SizeOf(typeof(JOBOBJECT_EXTENDED_LIMIT_INFORMATION));
            Check(SetInformationJobObject(job, JobObjectExtendedLimitInformation, ref limits, informationSize));

            var startup = new STARTUPINFO();
            startup.cb = Marshal.SizeOf(typeof(STARTUPINFO));
            startup.dwFlags = STARTF_USESTDHANDLES;
            startup.hStdInput = GetStdHandle(STD_INPUT_HANDLE);
            startup.hStdOutput = GetStdHandle(STD_OUTPUT_HANDLE);
            startup.hStdError = GetStdHandle(STD_ERROR_HANDLE);
            Check(startup.hStdInput != IntPtr.Zero && startup.hStdOutput != IntPtr.Zero && startup.hStdError != IntPtr.Zero);
            string command = Quote(pythonPath) + " " + Quote(workerPath) + " " + Quote(sourcePath);
            Check(CreateProcess(pythonPath, new StringBuilder(command), IntPtr.Zero, IntPtr.Zero, true,
                CREATE_SUSPENDED | CREATE_NO_WINDOW, IntPtr.Zero, System.IO.Path.GetDirectoryName(pythonPath), ref startup, out process));
            created = true;
            Check(AssignProcessToJobObject(job, process.hProcess));
            JOBOBJECT_EXTENDED_LIMIT_INFORMATION verified;
            uint returned;
            Check(QueryInformationJobObject(job, JobObjectExtendedLimitInformation, out verified, informationSize, out returned));
            bool inJob;
            Check(IsProcessInJob(process.hProcess, job, out inJob) && inJob);
            if ((verified.BasicLimitInformation.LimitFlags & (JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE))
                    != (JOB_OBJECT_LIMIT_JOB_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE)
                || verified.JobMemoryLimit.ToUInt64() != 2147483648UL) throw new InvalidOperationException();
            Console.Error.WriteLine("H2_JOB_READY:" + process.dwProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
            Console.Error.Flush();
            Check(ResumeThread(process.hThread) != 0xffffffff);
            resumed = true;
            uint wait = WaitForMultipleObjects(2, new IntPtr[] { process.hProcess, coordinator }, false, INFINITE);
            if (wait == 1) {
                Check(TerminateJobObject(job, 0xE0020002));
                Check(WaitForSingleObject(process.hProcess, INFINITE) == 0);
                Console.Error.WriteLine("H2_COORDINATOR_EXITED");
                Console.Error.Flush();
                return 79;
            }
            Check(wait == 0);
            uint exitCode;
            Check(GetExitCodeProcess(process.hProcess, out exitCode));
            Console.Error.WriteLine("H2_PROCESS_TERMINATED:" + process.dwProcessId.ToString(System.Globalization.CultureInfo.InvariantCulture));
            Console.Error.Flush();
            return unchecked((int)exitCode);
        } catch {
            Console.Error.WriteLine("H2_JOB_SETUP_FAILED");
            Console.Error.Flush();
            if (created && !resumed && process.hProcess != IntPtr.Zero) TerminateProcess(process.hProcess, 0xE0020001);
            return 77;
        } finally {
            if (process.hThread != IntPtr.Zero) CloseHandle(process.hThread);
            if (process.hProcess != IntPtr.Zero) CloseHandle(process.hProcess);
            if (coordinator != IntPtr.Zero) CloseHandle(coordinator);
            if (job != IntPtr.Zero) CloseHandle(job);
        }
    }
}
'@

try {
  Add-Type -TypeDefinition $nativeSource -Language CSharp -ErrorAction Stop | Out-Null
  $exit = [VolkH2JobSupervisor]::Run($PythonPath, $WorkerPath, $SourcePath, [uint32]$CoordinatorPid)
  exit $exit
} catch {
  [Console]::Error.WriteLine('H2_SUPERVISOR_UNAVAILABLE')
  exit 78
}
