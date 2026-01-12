/**
 * Tests for FolderManager recursive folder search functionality
 *
 * Issue #124: Support recursive folder search for custom folder organization
 */

import { FolderManager } from '../src/modules/drive/FolderManager';

// Helper to create a mock folder iterator
function createFolderIterator(folders: any[]): any {
  let index = 0;
  return {
    hasNext: () => index < folders.length,
    next: () => folders[index++]
  };
}

// Helper to create a mock folder
function createMockFolder(name: string, children: any[] = [], subfolders: any[] = []): any {
  return {
    getName: () => name,
    getId: () => `folder-${name}`,
    getFoldersByName: (searchName: string) => {
      const matching = children.filter(f => f.getName() === searchName);
      return createFolderIterator(matching);
    },
    getFolders: () => createFolderIterator(subfolders),
    createFolder: jest.fn((folderName: string) => createMockFolder(folderName))
  };
}

// Mock DriveApp
const mockDriveApp = {
  getFolderById: jest.fn()
};

// Mock Utilities for sleep (used in retry logic)
const mockUtilities = {
  sleep: jest.fn()
};

// Mock AppLogger
jest.mock('../src/utils/logger', () => ({
  AppLogger: {
    debug: jest.fn(),
    info: jest.fn(),
    error: jest.fn()
  }
}));

// Set up globals
(globalThis as any).DriveApp = mockDriveApp;
(globalThis as any).Utilities = mockUtilities;

describe('FolderManager', () => {
  const ROOT_FOLDER_ID = 'root-folder-id';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getOrCreateMonthFolder', () => {
    describe('finds folder at root level (backward compatible)', () => {
      it('should find folder directly under root', () => {
        // Structure: ROOT/2024-12/
        const targetFolder = createMockFolder('2024-12');
        const rootFolder = createMockFolder('ROOT', [targetFolder], []);

        mockDriveApp.getFolderById.mockReturnValue(rootFolder);

        const manager = new FolderManager(ROOT_FOLDER_ID);
        const result = manager.getOrCreateMonthFolder('2024-12');

        expect(result.getName()).toBe('2024-12');
        expect(rootFolder.createFolder).not.toHaveBeenCalled();
      });
    });

    describe('finds folder in child folder (fiscal year use case)', () => {
      it('should find folder under FY folder', () => {
        // Structure: ROOT/FY2024-12/2024-12/
        const targetFolder = createMockFolder('2024-12');
        const fyFolder = createMockFolder('FY2024-12', [targetFolder], []);
        const rootFolder = createMockFolder('ROOT', [], [fyFolder]);

        mockDriveApp.getFolderById.mockReturnValue(rootFolder);

        const manager = new FolderManager(ROOT_FOLDER_ID);
        const result = manager.getOrCreateMonthFolder('2024-12');

        expect(result.getName()).toBe('2024-12');
        expect(rootFolder.createFolder).not.toHaveBeenCalled();
      });

      it('should find folder under second child folder', () => {
        // Structure: ROOT/
        //   FY2023-12/ (no 2024-12)
        //   FY2024-12/2024-12/
        const targetFolder = createMockFolder('2024-12');
        const fy2023Folder = createMockFolder('FY2023-12', [], []);
        const fy2024Folder = createMockFolder('FY2024-12', [targetFolder], []);
        const rootFolder = createMockFolder('ROOT', [], [fy2023Folder, fy2024Folder]);

        mockDriveApp.getFolderById.mockReturnValue(rootFolder);

        const manager = new FolderManager(ROOT_FOLDER_ID);
        const result = manager.getOrCreateMonthFolder('2024-12');

        expect(result.getName()).toBe('2024-12');
        expect(rootFolder.createFolder).not.toHaveBeenCalled();
      });
    });

    describe('finds folder in grandchild folder', () => {
      it('should find folder 2 levels deep', () => {
        // Structure: ROOT/Year2024/Q4/2024-12/
        const targetFolder = createMockFolder('2024-12');
        const q4Folder = createMockFolder('Q4', [targetFolder], []);
        const yearFolder = createMockFolder('Year2024', [], [q4Folder]);
        const rootFolder = createMockFolder('ROOT', [], [yearFolder]);

        mockDriveApp.getFolderById.mockReturnValue(rootFolder);

        const manager = new FolderManager(ROOT_FOLDER_ID);
        const result = manager.getOrCreateMonthFolder('2024-12');

        expect(result.getName()).toBe('2024-12');
        expect(rootFolder.createFolder).not.toHaveBeenCalled();
      });
    });

    describe('prefers shallowest match', () => {
      it('should return root folder when same folder exists at multiple levels', () => {
        // Structure: ROOT/
        //   2024-12/  <- should find this one (shallowest)
        //   FY2024-12/2024-12/
        const rootTargetFolder = createMockFolder('2024-12');
        const nestedTargetFolder = createMockFolder('2024-12');
        const fyFolder = createMockFolder('FY2024-12', [nestedTargetFolder], []);
        const rootFolder = createMockFolder('ROOT', [rootTargetFolder], [fyFolder]);

        mockDriveApp.getFolderById.mockReturnValue(rootFolder);

        const manager = new FolderManager(ROOT_FOLDER_ID);
        const result = manager.getOrCreateMonthFolder('2024-12');

        expect(result.getName()).toBe('2024-12');
        expect(result.getId()).toBe('folder-2024-12');
      });
    });

    describe('creates folder at root when not found', () => {
      it('should create folder at root when not found anywhere', () => {
        // Structure: ROOT/FY2024-12/ (no 2024-12 anywhere)
        const fyFolder = createMockFolder('FY2024-12', [], []);
        const rootFolder = createMockFolder('ROOT', [], [fyFolder]);

        mockDriveApp.getFolderById.mockReturnValue(rootFolder);

        const manager = new FolderManager(ROOT_FOLDER_ID);
        const result = manager.getOrCreateMonthFolder('2024-12');

        expect(rootFolder.createFolder).toHaveBeenCalledWith('2024-12');
        expect(result.getName()).toBe('2024-12');
      });

      it('should create folder when root is empty', () => {
        const rootFolder = createMockFolder('ROOT', [], []);

        mockDriveApp.getFolderById.mockReturnValue(rootFolder);

        const manager = new FolderManager(ROOT_FOLDER_ID);
        const result = manager.getOrCreateMonthFolder('2024-12');

        expect(rootFolder.createFolder).toHaveBeenCalledWith('2024-12');
        expect(result.getName()).toBe('2024-12');
      });
    });

    describe('respects max depth limit', () => {
      it('should not search beyond 2 levels deep', () => {
        // Structure: ROOT/Level1/Level2/Level3/2024-12/ (too deep - should not find)
        const targetFolder = createMockFolder('2024-12');
        const level3Folder = createMockFolder('Level3', [targetFolder], []);
        const level2Folder = createMockFolder('Level2', [], [level3Folder]);
        const level1Folder = createMockFolder('Level1', [], [level2Folder]);
        const rootFolder = createMockFolder('ROOT', [], [level1Folder]);

        mockDriveApp.getFolderById.mockReturnValue(rootFolder);

        const manager = new FolderManager(ROOT_FOLDER_ID);
        manager.getOrCreateMonthFolder('2024-12');

        // Should create at root because search depth is limited to 2
        expect(rootFolder.createFolder).toHaveBeenCalledWith('2024-12');
      });
    });

    describe('handles complex folder structures', () => {
      it('should handle multiple fiscal year folders', () => {
        // Structure: ROOT/
        //   FY2023-12/2023-12/
        //   FY2024-12/2024-12/ <- should find this
        //   FY2025-12/
        const target2023 = createMockFolder('2023-12');
        const target2024 = createMockFolder('2024-12');
        const fy2023 = createMockFolder('FY2023-12', [target2023], []);
        const fy2024 = createMockFolder('FY2024-12', [target2024], []);
        const fy2025 = createMockFolder('FY2025-12', [], []);
        const rootFolder = createMockFolder('ROOT', [], [fy2023, fy2024, fy2025]);

        mockDriveApp.getFolderById.mockReturnValue(rootFolder);

        const manager = new FolderManager(ROOT_FOLDER_ID);
        const result = manager.getOrCreateMonthFolder('2024-12');

        expect(result.getName()).toBe('2024-12');
        expect(rootFolder.createFolder).not.toHaveBeenCalled();
      });
    });
  });
});
