import { BrowserView, app, ipcMain, Dialog } from 'electron';
import { join } from 'path';
import { SearchDialog } from '../dialogs/search';
import { PreviewDialog } from '../dialogs/preview';
import { PersistentDialog } from '../dialogs/dialog';
import { Application } from '../application';
import { extensions } from 'electron-extensions';

interface IDialogShowOptions {
  name: string;
  browserWindow: Electron.BrowserWindow;
  bounds: Electron.Rectangle;
  hideTimeout?: number;
  devtools?: boolean;
  associateTab?: boolean;
  onVisibilityChange?: (visible: boolean, tabId: number) => any;
  onHide?: (dialog: IDialog) => void;
}

interface IDialog {
  name: string;
  browserView: BrowserView;
  id: number;
  tabIds: number[];
  hide: (tabId?: number) => void;
  handle: (name: string, cb: (...args: any[]) => any) => void;
  on: (name: string, cb: (...args: any[]) => any) => void;
}

export class DialogsService {
  public browserViews: BrowserView[] = [];
  public browserViewDetails = new Map<number, boolean>();
  public dialogs: IDialog[] = [];

  public persistentDialogs: PersistentDialog[] = [];

  public run() {
    this.createBrowserView();

    this.persistentDialogs.push(new SearchDialog());
    this.persistentDialogs.push(new PreviewDialog());
  }

  private createBrowserView() {
    const view = new BrowserView({
      webPreferences: {
        nodeIntegration: true,
        contextIsolation: false,
        enableRemoteModule: true,
        webviewTag: true,
      },
    });

    view.webContents.loadURL(`about:blank`);

    this.browserViews.push(view);

    this.browserViewDetails.set(view.id, false);

    return view;
  }

  public show(options: IDialogShowOptions): IDialog {
    const {
      name,
      browserWindow,
      bounds,
      devtools,
      onHide,
      hideTimeout,
      associateTab,
      onVisibilityChange,
    } = options;

    const foundDialog = this.getDynamic(name);

    let browserView = foundDialog
      ? foundDialog.browserView
      : this.browserViews.find((x) => !this.browserViewDetails.get(x.id));

    if (!browserView && !foundDialog) {
      browserView = this.createBrowserView();
    }

    const appWindow = Application.instance.windows.fromBrowserWindow(
      browserWindow,
    );

    const tab = appWindow.viewManager.selected;

    if (foundDialog) {
      foundDialog.tabIds.push(tab.id);
    }

    browserWindow.webContents.send('dialog-visibility-change', name, true);

    bounds.x = Math.round(bounds.x);
    bounds.y = Math.round(bounds.y);

    browserWindow.addBrowserView(browserView);
    browserView.setBounds(bounds);

    if (foundDialog) {
      const data = onVisibilityChange && onVisibilityChange(true, tab.id);
      browserView.webContents.send('visibility-changed', true, tab.id, data);
    }

    if (foundDialog) return null;

    if (process.env.NODE_ENV === 'development') {
      browserView.webContents.loadURL(`http://localhost:4444/${name}.html`);
    } else {
      browserView.webContents.loadURL(
        join('file://', app.getAppPath(), `build/${name}.html`),
      );
    }

    browserView.webContents.focus();

    if (devtools) {
      // browserView.webContents.openDevTools({ mode: 'detach' });
    }

    const channels: string[] = [];

    let activateHandler: any;
    let closeHandler: any;

    const dialog: IDialog = {
      browserView,
      id: browserView.id,
      name,
      tabIds: [tab.id],
      hide: (tabId) => {
        const { selectedId } = appWindow.viewManager;

        dialog.tabIds = dialog.tabIds.filter(
          (x) => x !== (tabId || selectedId),
        );

        if (tabId && tabId !== selectedId) return;

        browserWindow.webContents.send('dialog-visibility-change', name, false);

        browserWindow.removeBrowserView(browserView);

        if (dialog.tabIds.length > 0) return;

        ipcMain.removeAllListeners(`hide-${browserView.webContents.id}`);
        channels.forEach((x) => {
          ipcMain.removeHandler(x);
          ipcMain.removeAllListeners(x);
        });

        this.dialogs = this.dialogs.filter((x) => x.id !== dialog.id);

        if (this.browserViews.length > 2) {
          browserView.destroy();
          this.browserViews.splice(2, 1);
          this.browserViewDetails.delete(browserView.id);
        } else {
          browserView.webContents.loadURL('about:blank');
          this.browserViewDetails.set(browserView.id, false);
        }

        if (associateTab) {
          appWindow.viewManager.off('activated', activateHandler);
          appWindow.viewManager.off('activated', closeHandler);
        }

        if (onHide) onHide(dialog);
      },
      handle: (name, cb) => {
        const channel = `${name}-${browserView.webContents.id}`;
        ipcMain.handle(channel, (...args) => cb(...args));
        channels.push(channel);
      },
      on: (name, cb) => {
        const channel = `${name}-${browserView.webContents.id}`;
        ipcMain.on(channel, (...args) => cb(...args));
        channels.push(channel);
      },
    };

    if (associateTab) {
      activateHandler = (tabId: number) => {
        const visible = dialog.tabIds.includes(tabId);
        browserWindow.webContents.send(
          'dialog-visibility-change',
          name,
          visible,
        );

        const data = onVisibilityChange && onVisibilityChange(visible, tabId);

        browserView.webContents.send(
          'visibility-changed',
          visible,
          tabId,
          data,
        );

        if (visible) {
          browserWindow.removeBrowserView(browserView);
          browserWindow.addBrowserView(browserView);
        } else {
          browserWindow.removeBrowserView(browserView);
        }
      };

      closeHandler = (tabId: number) => {
        dialog.hide(tabId);
      };

      // TODO: handle tab removed

      appWindow.viewManager.on('removed', closeHandler);
      appWindow.viewManager.on('activated', activateHandler);
    }

    this.browserViewDetails.set(browserView.id, true);

    ipcMain.on(`hide-${browserView.webContents.id}`, () => {
      dialog.hide();
    });

    this.dialogs.push(dialog);

    return dialog;
  }

  public getBrowserViews = () => {
    return this.browserViews.concat(
      Array.from(this.persistentDialogs).map((x) => x.browserView),
    );
  };

  public destroy = () => {
    this.getBrowserViews().forEach((x) => x.destroy());
  };

  public sendToAll = (channel: string, ...args: any[]) => {
    this.getBrowserViews().forEach((x) => x.webContents.send(channel, ...args));
  };

  public get(name: string) {
    return this.getDynamic(name) || this.getPersistent(name);
  }

  public getDynamic(name: string) {
    return this.dialogs.find((x) => x.name === name);
  }

  public getPersistent(name: string) {
    return this.persistentDialogs.find((x) => x.name === name);
  }

  public isVisible = (name: string) => {
    return this.getDynamic(name) || this.getPersistent(name)?.visible;
  };
}
