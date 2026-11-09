using System.Runtime.InteropServices;
using DataCore.PdmLoader;
using DataCore.PdmLoader.Tools;

static class Entry
{
    [DllImport("kernel32.dll")]
    static extern bool AllocConsole();

    [STAThread]
    static int Main(string[] args)
    {
        // Без окна: сверка эталона или выгрузка пакета
        if (args.Length > 0)
        {
            AllocConsole();
            try
            {
                return Cli.Run(args);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine(ex.ToString());
                return 2;
            }
        }

        ApplicationConfiguration.Initialize();
        Application.Run(new MainForm());
        return 0;
    }
}
